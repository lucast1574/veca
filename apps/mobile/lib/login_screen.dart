// Flutter 3.44 is also used by the iOS build environment.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import 'gallery_api.dart';
import 'session.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, required this.busy, this.error});
  final bool busy;
  final Object? error;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _passwordMode = false;
  bool _browserBusy = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _google() async {
    setState(() {
      _browserBusy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).openGoogle();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is GalleryError
              ? error.message
              : 'No pudimos abrir Google.',
        );
      }
    } finally {
      if (mounted) setState(() => _browserBusy = false);
    }
  }

  void _login() {
    if (_username.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Escribe tu correo y contraseña.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _error = null);
    ref
        .read(sessionProvider.notifier)
        .login(_username.text.trim(), _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final busy = widget.busy || _browserBusy;
    final apiError = widget.error;
    final error =
        _error ??
        (apiError is GalleryError
            ? apiError.message
            : apiError == null
            ? null
            : 'No pudimos recuperar tu sesión.');
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SvgPicture.asset(
                    'assets/logo.svg',
                    width: 80,
                    height: 54,
                    semanticsLabel: 'Vidrios VECA',
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Galería VECA',
                    style: theme.textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -2,
                      height: 1.05,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text('Las fotos de obra de tu equipo, en tu celular.'),
                  if (!_passwordMode) ...[
                    const SizedBox(height: 24),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: AspectRatio(
                        aspectRatio: 16 / 9,
                        child: Image.asset(
                          'assets/vivienda-720.webp',
                          fit: BoxFit.cover,
                          excludeFromSemantics: true,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  if (_passwordMode) ...[
                    TextField(
                      controller: _username,
                      enabled: !busy,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Correo o usuario',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      enabled: !busy,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _login(),
                      decoration: const InputDecoration(
                        labelText: 'Contraseña',
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: busy
                          ? null
                          : (_passwordMode ? _login : _google),
                      child: Text(
                        busy
                            ? 'Conectando…'
                            : (_passwordMode
                                  ? 'Iniciar sesión'
                                  : 'Continuar con Google'),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => setState(() {
                              _passwordMode = !_passwordMode;
                              _error = null;
                            }),
                      child: Text(
                        _passwordMode
                            ? 'Usar Google'
                            : 'Usar correo y contraseña',
                      ),
                    ),
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          error,
                          style: TextStyle(color: theme.colorScheme.error),
                        ),
                      ),
                    ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: () => launchUrl(
                      Uri.parse(site).resolve('/privacidad/'),
                      mode: LaunchMode.externalApplication,
                    ),
                    child: const Text('Privacidad'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
