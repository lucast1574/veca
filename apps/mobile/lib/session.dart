import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'gallery_api.dart';

final galleryApiProvider = Provider((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return GalleryApi(client);
});

final sessionProvider =
    AsyncNotifierProvider<SessionController, GallerySession?>(
      SessionController.new,
    );

class GallerySession {
  const GallerySession(this.token, this.name, this.email, this.review);
  final String token;
  final String name;
  final String? email;
  final bool review;
}

class SessionController extends AsyncNotifier<GallerySession?> {
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'veca-session';
  static const _verifierKey = 'veca-oauth-verifier';
  GalleryApi get _api => ref.read(galleryApiProvider);

  @override
  Future<GallerySession?> build() async {
    final links = AppLinks();
    var received = false;
    final subscription = links.uriLinkStream.listen((uri) {
      if (received || !_isCallback(uri)) return;
      received = true;
      unawaited(_googleCallback(uri).whenComplete(() => received = false));
    });
    ref.onDispose(() => unawaited(subscription.cancel()));
    final initial = await links.getInitialLink();
    if (initial != null && _isCallback(initial) && !received) {
      final code = initial.queryParameters['code'];
      final verifier = await _storage.read(key: _verifierKey);
      if (code != null && verifier != null) return _exchange(code, verifier);
    }
    final token = await _storage.read(key: _tokenKey);
    if (token == null) return null;
    try {
      return await _load(token);
    } on GalleryError catch (error) {
      if (error.status != 401 && error.status != 403) rethrow;
      await _storage.delete(key: _tokenKey);
      return null;
    }
  }

  Future<GallerySession> _load(String token) async {
    final data = await _api.request('/mobile/auth/me', token: token);
    return GallerySession(
      token,
      data['name'] as String,
      data['email'] as String?,
      data['review'] == true,
    );
  }

  Future<GallerySession> _start(String path, Map<String, dynamic> data) async {
    final response = await _api.request(path, data: data);
    final session = await _load(response['token'] as String);
    await _storage.write(key: _tokenKey, value: session.token);
    return session;
  }

  Future<void> login(String username, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => _start('/mobile/auth/login', {
        'username': username,
        'password': password,
      }),
    );
  }

  Future<void> openGoogle() async {
    final random = Random.secure();
    final verifier = base64UrlEncode(
      List<int>.generate(32, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
    await _storage.write(key: _verifierKey, value: verifier);
    final challenge = sha256.convert(utf8.encode(verifier));
    final uri = Uri.parse(site)
        .resolve('/galeria/acceso/')
        .replace(fragment: 'challenge=$challenge');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      await _storage.delete(key: _verifierKey);
      throw const GalleryError('No pudimos abrir el acceso con Google.');
    }
  }

  bool _isCallback(Uri uri) =>
      uri.scheme == 'vecagaleria' && uri.host == 'acceso';

  Future<void> _googleCallback(Uri uri) async {
    final code = uri.queryParameters['code'];
    final verifier = await _storage.read(key: _verifierKey);
    if (code == null || verifier == null || state.value != null) return;
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _exchange(code, verifier));
  }

  Future<GallerySession> _exchange(String code, String verifier) async {
    final session = await _start('/mobile/auth/exchange', {
      'code': code,
      'verifier': verifier,
    });
    await _storage.delete(key: _verifierKey);
    return session;
  }

  Future<void> logout({bool expired = false}) async {
    final token = state.value?.token;
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _verifierKey);
    PaintingBinding.instance.imageCache.clear();
    PaintingBinding.instance.imageCache.clearLiveImages();
    state = const AsyncData(null);
    if (token == null || expired) return;
    try {
      await _api.request('/mobile/auth/logout', token: token, data: {});
    } on GalleryError {
      // The local session is already cleared.
    }
  }
}
