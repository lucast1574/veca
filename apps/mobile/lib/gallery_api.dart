import 'dart:convert';

import 'package:http/http.dart' as http;

const site = String.fromEnvironment(
  'VECA_SITE',
  defaultValue: 'https://veca.com.pe',
);
const apiOrigin = String.fromEnvironment(
  'VECA_API',
  defaultValue: 'https://api.veca.com.pe',
);

class GalleryError implements Exception {
  const GalleryError(this.message, {this.status});
  final String message;
  final int? status;

  @override
  String toString() => message;
}

class GalleryApi {
  GalleryApi(this._client);
  final http.Client _client;

  Future<Map<String, dynamic>> request(
    String path, {
    String? token,
    Map<String, dynamic>? data,
    Map<String, String>? query,
  }) async {
    final uri = Uri.parse(apiOrigin)
        .resolve(path)
        .replace(queryParameters: query);
    final request = http.Request(data == null ? 'GET' : 'POST', uri)
      ..followRedirects = false
      ..headers['Accept'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (data != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(data);
    }
    final http.Response response;
    try {
      response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 15));
    } on Exception {
      throw const GalleryError(
        'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
      );
    }
    Map<String, dynamic>? body;
    try {
      body =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>?;
    } on FormatException {
      // An intermediary may return a non-JSON error page.
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body == null) {
      throw GalleryError(
        body?['message'] is String
            ? body!['message'] as String
            : 'No pudimos completar la solicitud.',
        status: response.statusCode,
      );
    }
    return body;
  }

  Future<PhotoPage> photos(String token, String search, int page) async {
    final json = await request(
      '/mobile/photos',
      token: token,
      query: {'search': search, 'page': '$page'},
    );
    return PhotoPage(
      (json['items'] as List)
          .cast<Map<String, dynamic>>()
          .map(Photo.fromJson)
          .toList(),
      json['total'] as int,
      json['pages'] as int,
    );
  }
}

class Photo {
  const Photo(this.id, this.title, this.subtitle, this.url);
  factory Photo.fromJson(Map<String, dynamic> json) => Photo(
    json['id'] as String,
    json['title'] as String,
    json['subtitle'] as String,
    json['url'] as String,
  );

  final String id;
  final String title;
  final String subtitle;
  final String url;

  Uri get uri => Uri.parse(apiOrigin).resolve(url);
  Map<String, String> headers(String token) => url.startsWith('/mobile/')
      ? {'Authorization': 'Bearer $token'}
      : const {};
}

class PhotoPage {
  const PhotoPage(this.photos, this.total, this.pages);
  final List<Photo> photos;
  final int total;
  final int pages;
}
