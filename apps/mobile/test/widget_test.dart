import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:galeria/main.dart';
import 'package:galeria/session.dart';

class SignedOutSession extends SessionController {
  @override
  Future<GallerySession?> build() async => null;
}

void main() {
  testWidgets('shows Google and accessible password sign-in', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [sessionProvider.overrideWith(SignedOutSession.new)],
        child: const VecaGallery(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Galería VECA'), findsOneWidget);
    expect(find.text('Continuar con Google'), findsOneWidget);
    await tester.tap(find.text('Usar correo y contraseña'));
    await tester.pumpAndSettle();
    expect(find.text('Correo o usuario'), findsOneWidget);
    expect(find.text('Contraseña'), findsOneWidget);
  });
}
