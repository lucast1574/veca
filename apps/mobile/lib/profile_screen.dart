// Flutter 3.44 is also used by the iOS build environment.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'gallery_api.dart';
import 'session.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key, required this.session});
  final GallerySession session;

  Future<void> _open(BuildContext context, String path) async {
    if (!await launchUrl(
          Uri.parse(site).resolve(path),
          mode: LaunchMode.externalApplication,
        ) &&
        context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pudimos abrir la página.')),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Mi perfil')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              session.name,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            if (session.email != null) ...[
              const SizedBox(height: 8),
              Text(session.email!),
            ],
            const SizedBox(height: 26),
            ListTile(
              leading: const Icon(Icons.privacy_tip_outlined),
              title: const Text('Política de privacidad'),
              onTap: () => _open(context, '/privacidad/'),
            ),
            ListTile(
              leading: const Icon(Icons.help_outline_rounded),
              title: const Text('Soporte'),
              onTap: () => _open(context, '/galeria/'),
            ),
            const SizedBox(height: 18),
            ListTile(
              leading: const Icon(Icons.logout_rounded),
              title: const Text('Cerrar sesión'),
              onTap: () async {
                final controller = ref.read(sessionProvider.notifier);
                Navigator.of(context).pop();
                await controller.logout();
              },
            ),
            ListTile(
              leading: Icon(
                Icons.delete_outline_rounded,
                color: theme.colorScheme.error,
              ),
              title: Text(
                'Eliminar cuenta',
                style: TextStyle(color: theme.colorScheme.error),
              ),
              onTap: () => _open(context, '/eliminar-cuenta/'),
            ),
          ],
        ),
      ),
    );
  }
}
