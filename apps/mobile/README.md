# Galería VECA

App Flutter para Android e iOS. Usa la cuenta existente del panel, con Google o correo y contraseña. La API vuelve a comprobar el permiso de Galería en cada consulta. Las cuentas de revisión solo tienen acceso a fotos de muestra.

```bash
flutter pub get
flutter analyze
flutter test
flutter run
```

Para apuntar a QA, pasar las URL con `--dart-define=VECA_API=...` y `--dart-define=VECA_SITE=...`. Por defecto usa `api.veca.com.pe` y `veca.com.pe`.

Android usa `pe.com.veca.galeria`. Para `flutter build appbundle --release`, definir `VECA_ANDROID_KEYSTORE` y `VECA_ANDROID_STORE_PASSWORD` con el almacén de firma que contiene `veca-upload`. El bundle ID de iOS es `pe.com.veca.galeria`. En ambos sistemas, `vecagaleria://acceso` devuelve el control desde Google a la app.

Las cuentas `review-google-play` y `review-app-store` se aprovisionan al arrancar la API con hashes Argon2id mediante `MOBILE_REVIEW_GOOGLE_HASH` y `MOBILE_REVIEW_APPLE_HASH`. Retirar esas variables después de aprobar el aprovisionamiento para que las cuentas, si se eliminan, no vuelvan a crearse.
