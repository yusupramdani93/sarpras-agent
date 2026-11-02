# Kebijakan Privasi - Sarpras Dapo Agent

Versi 1.0

## 1. Ringkasan
Sarpras Dapo Agent adalah aplikasi desktop untuk mengambil data Sarpras dari
Dapodik lokal dan mengirimkannya ke server yang **Anda tentukan sendiri**
(`cpaneAPIURL`). Aplikasi tidak mengirim data ke server pihak ketiga.

## 2. Data yang dikumpulkan/dikirim
- Kredensial Dapodik (username, password, kode registrasi) yang Anda masukkan.
- Data Sarpras sekolah (tanah, bangunan, ruang, alat, dan data longitudinal).
- Kredensial disimpan secara lokal di mesin Anda (`agent_config.json`).

## 3. Penyimpanan
- Konfigurasi disimpan lokal di folder aplikasi atau `%LOCALAPPDATA%\SarprasDapo`.
- Data dikirim melalui HTTPS ke server yang Anda konfigurasi.

## 4. Kontrol pengguna
- Anda dapat menghapus `agent_config.json` kapan saja.
- Anda dapat memilih koleksi data yang disinkronkan.
- Anda menentukan server tujuan.

## 5. Komponen pihak ketiga
Aplikasi ini menggunakan pustaka open-source (Go, Fyne). Lihat `go.mod`.

## 6. Kontak
Laporkan masalah ke: https://github.com/<owner>/sarpras-agent/issues