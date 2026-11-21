// Flutter 3.44 is also used by the iOS build environment.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'gallery_screen.dart';
import 'login_screen.dart';
import 'session.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: VecaGallery()));
}

class VecaGallery extends ConsumerWidget {
  const VecaGallery({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return MaterialApp(
      title: 'Galería VECA',
      debugShowCheckedModeBanner: false,
      locale: const Locale('es', 'PE'),
      supportedLocales: const [Locale('es', 'PE')],
      // ignore: deprecated_member_use
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: galleryTheme(Brightness.light),
      darkTheme: galleryTheme(Brightness.dark),
      home: session.value == null
          ? LoginScreen(busy: session.isLoading, error: session.error)
          : GalleryScreen(
              key: ValueKey(session.value!.token),
              session: session.value!,
            ),
    );
  }
}
