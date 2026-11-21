// Flutter 3.44 is also used by the iOS build environment.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

const navy = Color(0xff242641);
const paper = Color(0xfff5f4f0);
const accent = Color(0xffa43621);
const inkLight = Color(0xfff1f0f7);

ThemeData galleryTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final colors = ColorScheme.fromSeed(
    seedColor: accent,
    brightness: brightness,
    primary: dark ? const Color(0xffffa48c) : accent,
    onPrimary: dark ? const Color(0xff39130b) : Colors.white,
    surface: dark ? const Color(0xff171925) : paper,
    onSurface: dark ? inkLight : navy,
    surfaceContainerHighest: dark ? const Color(0xff272b3c) : Colors.white,
  );
  const border = OutlineInputBorder(
    borderSide: BorderSide.none,
    borderRadius: BorderRadius.all(Radius.circular(12)),
  );
  return ThemeData(
    colorScheme: colors,
    fontFamily: 'Manrope',
    scaffoldBackgroundColor: colors.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      scrolledUnderElevation: 0,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surfaceContainerHighest,
      focusColor: colors.primary.withValues(alpha: .12),
      border: border,
      enabledBorder: border,
      focusedBorder: border,
      errorBorder: border,
      focusedErrorBorder: border,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
  );
}
