# Sarpras Dapo Agent

Agen desktop (Go + Fyne) untuk mengambil data Sarpras dari Dapodik lokal
(`http://localhost:5774`) dan mengirimkannya ke server Sarpras.

## Fitur
- Login ke Dapodik, sinkronisasi sekolah, tanah, bangunan, ruang, alat, dan
  data longitudinal (periodik).
- GUI sederhana dengan progress dan log.
- Konfigurasi disimpan lokal.

## Cara pakai
1. Unduh `sarpras-agent.exe` dari Releases.
2. Jalankan, isi kredensial Dapodik (email, password, kode registrasi) dan
   API Key server.
3. Pilih koleksi data, klik **Mulai Sync ke Server**.

## Build dari sumber
```powershell
cd agent
go build -o sarpras-agent.exe .
# atau
.\build.ps1 -Version 1.0.0
```

## Kebijakan penandatanganan kode (Code signing policy)
- Free code signing provided by [SignPath.io](https://about.signpath.io),
  certificate by [SignPath Foundation](https://signpath.org).
- Committers and reviewers: maintainer.
- Approvers: maintainer.
- Privasi: aplikasi mengirim kredensial dan data Sarpras hanya ke server yang
  Anda tentukan sendiri. Lihat [PRIVACY.md](PRIVACY.md).

## Lisensi
MIT - lihat [LICENSE](LICENSE).