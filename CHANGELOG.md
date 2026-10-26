# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **iOS and Android app (preview):** `app/` wraps the client in a Capacitor
  shell, so iPhones and iPads can connect smart trainers, heart rate straps
  and Zwift controllers. That is impossible in any iOS browser. A polyfill
  (`ble/nativeBluetooth.js`) gives the existing device code the Web
  Bluetooth it expects, backed by native Bluetooth. Inside the app the screen
  stays on and ride files open the share sheet. *Connect with Strava* uses the
  system sign-in sheet, so Google and Apple sign-in work too. On iOS, devices
  stay connected while the app is in the background. Browsers are unaffected
  ([docs/app.md](docs/app.md), ADR 0017).
