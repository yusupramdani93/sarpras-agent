package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"
)

var cpaneAPIURL = "https://sarpras.cilograng.com"

// Kunci API diset dari config / input pengguna (tidak disematkan di binary).
var cpaneAPIKey = ""
var version = "dev"
// Client untuk server API, diberi timeout agar tidak menggantung selamanya.
var apiHTTPClient = &http.Client{Timeout: 90 * time.Second}

const (
	dapodikHost = "http://localhost:5774"
	semesterId  = "20261"
)

type AppConfig struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	Koreg     string `json:"koreg"`
	CPANELURL string `json:"cpaneAPIURL"`
	APIKey    string `json:"apiKey"`
}

type colDef struct {
	Label    string
	Endpoint string
	Table    string
	IDField  string
}

// Urutan mengikuti ketergantungan foreign key: tanah -> bangunan -> ruang -> alat,
// lalu tabel periodik setelah tabel induknya.
var allCols = []colDef{
	{"Tanah", "/rest/Tanah", "tanah", "id_tanah"},
	{"Bangunan", "/rest/Bangunan", "bangunan", "id_bangunan"},
	{"Ruang", "/rest/Ruang", "ruang", "id_ruang"},
	{"Alat", "/rest/Alat", "alat", "id_alat"},
	{"Alat Periodik", "/rest/AlatLongitudinal", "alat_longitudinal", "alat_longitudinal_id"},
	{"Bangunan Periodik", "/rest/BangunanLongitudinal", "bangunan_longitudinal", "id_bangunan"},
	{"Ruang Periodik", "/rest/RuangLongitudinal", "ruang_longitudinal", "ruang_longitudinal_id"},
	{"Tanah Periodik", "/rest/TanahLongitudinal", "tanah_longitudinal", "id_tanah"},
}

func exeDir() string {
	ex, _ := os.Executable()
	return filepath.Dir(ex)
}

func writableConfigDir() string {
	dir := exeDir()
	if f, err := os.OpenFile(filepath.Join(dir, ".write-test"), os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		f.Close()
		os.Remove(filepath.Join(dir, ".write-test"))
		return dir
	}
	if uc, err := os.UserConfigDir(); err == nil {
		d := filepath.Join(uc, "SarprasDapo")
		os.MkdirAll(d, 0755)
		return d
	}
	return dir
}

func configPath() string {
	return filepath.Join(writableConfigDir(), "agent_config.json")
}

func loadConfig() AppConfig {
	var c AppConfig
	data, err := os.ReadFile(configPath())
	if err != nil {
		return c
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	json.Unmarshal(data, &c)
	return c
}

func saveConfig(c AppConfig) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), b, 0644)
}

func filterPayload(p interface{}) interface{} {
	m, ok := p.(map[string]interface{})
	if !ok {
		return p
	}
	out := map[string]interface{}{}
	for k, v := range m {
		if strings.HasSuffix(k, "_str") {
			continue
		}
		if k == "key_match" || k == "header" {
			continue
		}
		if k == "bentuk_pendidikan_id_str" || k == "kode_wilayah_str" || k == "kebutuhan_khusus_id_str" || k == "id_ruang_str" || k == "jenis_sarana_id_str" || k == "jenis_prasarana_id_str" || k == "sekolah_id_str" || k == "id_bangunan_str" || k == "id_tanah_str" {
			continue
		}
		if mv, ok := v.(map[string]interface{}); ok {
			out[k] = filterPayload(mv)
			continue
		}
		out[k] = v
	}
	return out
}

func postToCPANEL(endpoint string, payload interface{}) error {
	clean := filterPayload(payload)
	b, _ := json.Marshal(clean)
	req, err := http.NewRequest("POST", cpaneAPIURL+endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if cpaneAPIKey != "" {
		req.Header.Set("X-API-Key", cpaneAPIKey)
	}

	resp, err := apiHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("API %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

// Kirim banyak baris dalam satu request agar tidak lambat/stuck.
func postBulkToCPANEL(table string, rows []map[string]interface{}) error {
	cleaned := make([]interface{}, 0, len(rows))
	for _, row := range rows {
		cleaned = append(cleaned, filterPayload(row))
	}
	b, err := json.Marshal(map[string]interface{}{"rows": cleaned})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", cpaneAPIURL+"/api/agent/bulk/"+table, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if cpaneAPIKey != "" {
		req.Header.Set("X-API-Key", cpaneAPIKey)
	}

	resp, err := apiHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("API %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func main() {
	a := app.New()
	w := a.NewWindow("Sarpras Dapo Agent")
	w.Resize(fyne.NewSize(620, 700))
	w.SetFixedSize(true)

	cfg := loadConfig()

	title := widget.NewLabel("Sinkronisasi Data Sarpras ke Server")
	title.Alignment = fyne.TextAlignCenter
	title.TextStyle.Bold = true

	verLabel := widget.NewLabel("Versi " + version)
	verLabel.Alignment = fyne.TextAlignCenter

	userEntry := widget.NewEntry()
	userEntry.SetPlaceHolder("Email / Username Dapodik")
	userEntry.SetText(cfg.Username)

	passEntry := widget.NewPasswordEntry()
	passEntry.SetPlaceHolder("Password")
	passEntry.SetText(cfg.Password)

	koregEntry := widget.NewEntry()
	koregEntry.SetPlaceHolder("Kode Registrasi")
	koregEntry.SetText(cfg.Koreg)

	apiKeyEntry := widget.NewPasswordEntry()
	apiKeyEntry.SetPlaceHolder("API Key Server (kosongkan jika tidak dipakai)")
	apiKeyEntry.SetText(cfg.APIKey)

	status := widget.NewLabel("Siap")
	status.Alignment = fyne.TextAlignCenter

	progress := widget.NewProgressBar()
	progress.Min = 0
	progress.Max = 100
	progress.Value = 0

	logArea := widget.NewMultiLineEntry()
	logArea.SetPlaceHolder("Log aktivitas...")
	logArea.Disable()
	logArea.Wrapping = fyne.TextWrapWord

	appendLog := func(msg string) {
		cur := logArea.Text
		if cur != "" {
			cur += "\n"
		}
		cur += msg
		logArea.SetText(cur)
	}

	sekolahChk := widget.NewCheck("Sekolah", func(bool) {})
	sekolahChk.Checked = true

	checks := make([]*widget.Check, len(allCols))
	colBox := container.NewVBox()
	for i, c := range allCols {
		chk := widget.NewCheck(c.Label, func(bool) {})
		chk.Checked = true
		checks[i] = chk
		colBox.Add(chk)
	}

	var syncBtn *widget.Button
	syncBtn = widget.NewButton("Mulai Sync ke Server", func() {
		cfg.Username = userEntry.Text
		cfg.Password = passEntry.Text
		cfg.Koreg = koregEntry.Text
		cfg.APIKey = apiKeyEntry.Text
		if err := saveConfig(cfg); err != nil {
			dialog.ShowError(err, w)
			return
		}

		if cfg.Username == "" || cfg.Password == "" || cfg.Koreg == "" {
			dialog.ShowInformation("Peringatan", "Isi semua field terlebih dahulu", w)
			return
		}

		selected := 0
		if sekolahChk.Checked {
			selected++
		}
		for _, chk := range checks {
			if chk.Checked {
				selected++
			}
		}
		if selected == 0 {
			dialog.ShowInformation("Peringatan", "Pilih minimal satu koleksi data", w)
			return
		}

		syncBtn.Disable()
		userEntry.Disable()
		passEntry.Disable()
		koregEntry.Disable()
		sekolahChk.Disable()
		for _, chk := range checks {
			chk.Disable()
		}
		status.SetText("Sedang sinkronisasi...")
		progress.Value = 0
		progress.Refresh()

		go func() {
			defer func() {
				syncBtn.Enable()
				userEntry.Enable()
				passEntry.Enable()
				koregEntry.Enable()
				sekolahChk.Enable()
				for _, chk := range checks {
					chk.Enable()
				}
			}()

			err := runSync(cfg, sekolahChk.Checked, checks, allCols, appendLog, func(val float64) {
				progress.Value = val
				progress.Refresh()
			}, a)
			if err != nil {
				status.SetText("Gagal: " + err.Error())
				appendLog("ERROR: " + err.Error())
				dialog.ShowError(err, w)
			} else {
				status.SetText("Selesai! Data tersimpan di Server")
				progress.Value = 100
				progress.Refresh()
				appendLog("=== SINKRONISASI SELESAI ===")
				dialog.ShowInformation("Selesai", "Data sarpras berhasil disinkronkan ke Server.", w)
			}
		}()
	})

	content := container.NewVBox(
		title,
		verLabel,
		widget.NewSeparator(),
		widget.NewLabel("Kredensial Dapodik (disimpan secara lokal)"),
		userEntry,
		passEntry,
		koregEntry,
		apiKeyEntry,
		widget.NewSeparator(),
		widget.NewLabel("Pilih koleksi data yang ingin di-sinkronkan:"),
		sekolahChk,
		colBox,
		syncBtn,
		status,
		progress,
		widget.NewSeparator(),
		widget.NewLabel("Privasi: kredensial dikirim ke server yang Anda tentukan. Lihat PRIVACY.md di repo."),
		logArea,
	)

	w.SetContent(container.NewScroll(content))
	w.ShowAndRun()
}

func runSync(cfg AppConfig, syncSekolah bool, checks []*widget.Check, cols []colDef, log func(string), setProgress func(float64), a fyne.App) error {
	if key := strings.TrimSpace(cfg.APIKey); key != "" {
		cpaneAPIKey = key
	}

	// Abaikan URL lama (bendahara) agar instalasi lama ikut pindah ke server sarpras.
	if custom := strings.TrimRight(strings.TrimSpace(cfg.CPANELURL), "/"); custom != "" && !strings.Contains(custom, "bendahara.cilograng.com") {
		cpaneAPIURL = custom
	}

	log("Menginisialisasi...")
	log("Target API: " + cpaneAPIURL)

	jar, _ := cookiejar.New(nil)
	httpClient := &http.Client{Jar: jar, Timeout: 180 * time.Second}

	log("Login ke Dapodik...")
	resp, err := httpClient.Get(dapodikHost + "/")
	if err != nil {
		return fmt.Errorf("koneksi dapodik: %w", err)
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	body := string(bodyBytes)

	re := regexp.MustCompile(`name=['"]semester_id['"].*?option.+value=['"](\d+)['"].+selected`)
	m := re.FindStringSubmatch(body)
	sid := semesterId
	if len(m) > 1 {
		sid = m[1]
	}

	form := url.Values{}
	form.Set("username", cfg.Username)
	form.Set("password", cfg.Password)
	form.Set("semester_id", sid)
	form.Set("rememberme", "on")

	r, err := httpClient.PostForm(dapodikHost+"/roleperan", form)
	if err != nil {
		return fmt.Errorf("login roleperan: %w", err)
	}
	bb, _ := io.ReadAll(r.Body)
	r.Body.Close()
	roleBody := string(bb)

	m2 := regexp.MustCompile(`href=["'](\/login\?[^"']+)["']`).FindStringSubmatch(roleBody)
	if len(m2) < 2 {
		return fmt.Errorf("role tidak ditemukan setelah login")
	}
	httpClient.Get(dapodikHost + m2[1])

	form2 := url.Values{}
	form2.Set("koreg", cfg.Koreg)
	r2, _ := httpClient.PostForm(dapodikHost+"/cekkoreg", form2)
	bb2, _ := io.ReadAll(r2.Body)
	r2.Body.Close()
	if !strings.Contains(string(bb2), `"success":true`) && !strings.Contains(string(bb2), `"success" : true`) {
		return fmt.Errorf("kode registrasi salah: %s", string(bb2))
	}
	log("Login Dapodik sukses.")

	var sekolahId string
	var namaSekolah string
	yayasanTotal := 0
	if syncSekolah {
		// Yayasan harus masuk lebih dulu agar FK sekolah.yayasan_id valid.
		log("Mengambil data yayasan...")
		yayasanTotal = fetchAndPost(httpClient, dapodikHost+"/rest/Yayasan", "yayasan", "yayasan_id", "", log, nil)
		log(fmt.Sprintf("Yayasan: %d data", yayasanTotal))
		setProgress(5)

		log("Mengambil data sekolah...")
		sekolah, fetchErr := fetchJSON(httpClient, dapodikHost+"/rest/sekolah")
		if fetchErr != nil {
			return fmt.Errorf("ambil data sekolah: %w", fetchErr)
		}
		if rows, ok := sekolah["rows"].([]interface{}); ok && len(rows) > 0 {
			if m, ok := rows[0].(map[string]interface{}); ok {
				sekolahId, _ = m["sekolah_id"].(string)
				if v, ok := m["nama_sekolah"].(string); ok {
					namaSekolah = v
				} else if v, ok := m["nama"].(string); ok {
					namaSekolah = v
				} else if v, ok := m["sekolah_nama"].(string); ok {
					namaSekolah = v
				}
				err = postToCPANEL("/api/agent/sekolah", m)
				if err != nil {
					log("Peringatan kirim sekolah: " + err.Error())
				} else {
					log("Sekolah terkirim: " + sekolahId)
				}
			}
		}
		setProgress(10)
	}

	log("Menyimpan akun ke Server...")
	akunData := map[string]interface{}{
		"username":     cfg.Username,
		"password":     cfg.Password,
		"koreg":        cfg.Koreg,
		"id_sekolah":   sekolahId,
		"nama_sekolah": namaSekolah,
		"updatedAt":    time.Now(),
	}
	err = postToCPANEL("/api/agent/akun", akunData)
	if err != nil {
		log("Peringatan kirim akun: " + err.Error())
	} else {
		log("Akun terkirim: " + cfg.Username)
	}

	setProgress(15)

	type job struct {
		endpoint string
		table    string
		idField  string
		label    string
	}
	var jobs []job
	for i, chk := range checks {
		if chk.Checked {
			jobs = append(jobs, job{
				endpoint: cols[i].Endpoint,
				table:    cols[i].Table,
				idField:  cols[i].IDField,
				label:    cols[i].Label,
			})
		}
	}

	if len(jobs) == 0 {
		setProgress(100)
		return nil
	}

	step := 85.0 / float64(len(jobs))
	total := yayasanTotal
	for i, j := range jobs {
		count := fetchAndPost(httpClient, dapodikHost+j.endpoint, j.table, j.idField, sekolahId, log, func(done, all int) {
			fraction := 0.0
			if all > 0 {
				fraction = float64(done) / float64(all)
			}
			setProgress(15 + step*(float64(i)+fraction))
			if done > 0 && done%500 == 0 {
				log(fmt.Sprintf("%s: %d/%d diproses", j.label, done, all))
			}
		})
		total += count
		log(fmt.Sprintf("%s: %d data", j.label, count))
		setProgress(15 + step*float64(i+1))
	}

	log("Total sinkronisasi: " + fmt.Sprintf("%d", total))
	setProgress(100)
	return nil
}

// Dapodik membatasi jumlah baris per request, jadi data diambil per halaman.
func fetchAll(client *http.Client, path, label string, log func(string)) ([]interface{}, error) {
	const pageSize = 100

	var all []interface{}
	start := 0
	total := -1

	for page := 1; page <= 100000; page++ {
		separator := "?"
		if strings.Contains(path, "?") {
			separator = "&"
		}
		requestURL := fmt.Sprintf("%s%slimit=%d&start=%d", path, separator, pageSize, start)
		data, err := fetchJSON(client, requestURL)
		if err != nil {
			return all, err
		}

		rows, _ := data["rows"].([]interface{})
		if len(rows) == 0 {
			break
		}
		all = append(all, rows...)

		switch v := data["results"].(type) {
		case float64:
			total = int(v)
		case string:
			if n, convErr := strconv.Atoi(v); convErr == nil {
				total = n
			}
		}

		start += len(rows)
		if total >= 0 {
			if start >= total {
				break
			}
		} else if len(rows) < pageSize {
			break
		}
		if page%50 == 0 {
			log(fmt.Sprintf("%s: %d/%d baris diambil", label, start, total))
		}
	}

	if total >= 0 && len(all) < total {
		log(fmt.Sprintf("Peringatan: %s hanya %d dari %d baris terambil", label, len(all), total))
	}

	return all, nil
}

func fetchAndPost(client *http.Client, endpoint string, table, idField, sekolahId string, log func(string), onBatch func(done, total int)) int {
	log("Mengambil " + table + " dari Dapodik...")
	rows, err := fetchAll(client, endpoint, table, log)
	if err != nil {
		log("Gagal ambil " + table + ": " + err.Error())
		return 0
	}
	total := len(rows)
	log(fmt.Sprintf("%s: %d baris diterima dari Dapodik", table, total))

	const batchSize = 100
	processed := 0
	sent := 0
	batch := make([]map[string]interface{}, 0, batchSize)
	var parentUpdates []map[string]interface{}

	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := postBulkToCPANEL(table, batch); err != nil {
			log(fmt.Sprintf("Gagal kirim %s (%d baris): %s", table, len(batch), err.Error()))
		} else {
			sent += len(batch)
		}
		batch = make([]map[string]interface{}, 0, batchSize)
		if onBatch != nil {
			onBatch(processed, total)
		}
	}

	for _, row := range rows {
		m, ok := row.(map[string]interface{})
		if !ok {
			processed++
			continue
		}

		id, _ := m[idField].(string)
		if idField != "" && id == "" {
			processed++
			continue
		}

		if table != "yayasan" {
			m["sekolah_id"] = sekolahId
		}

		if table == "tanah_longitudinal" {
			tahunAjaran := ""
			switch v := m["tahun_ajaran_id"].(type) {
			case string:
				tahunAjaran = v
			case float64:
				tahunAjaran = fmt.Sprintf("%.0f", v)
			}
			if len(tahunAjaran) > 4 {
				tahunAjaran = tahunAjaran[:4]
			}
			if tahunAjaran == "" {
				tahunAjaran = fmt.Sprintf("%d", processed)
			}
			m["id_tanah"] = id
			m["tahun_ajaran_id"] = tahunAjaran
		}

		// FK ruang.parent_id_ruang bisa merujuk baris yang belum ada saat
		// batch pertama dikirim. Kirim dulu tanpa parent, lalu perbarui
		// parent pada pass kedua setelah semua ruang masuk.
		if table == "ruang" {
			if parent, ok := m["parent_id_ruang"].(string); ok && parent != "" {
				parentUpdates = append(parentUpdates, map[string]interface{}{
					"id_ruang":        id,
					"parent_id_ruang": parent,
				})
			}
			delete(m, "parent_id_ruang")
		}

		batch = append(batch, m)
		processed++
		if len(batch) >= batchSize {
			flush()
		}
	}
	flush()

	if len(parentUpdates) > 0 {
		updated := 0
		for i := 0; i < len(parentUpdates); i += batchSize {
			end := i + batchSize
			if end > len(parentUpdates) {
				end = len(parentUpdates)
			}
			chunk := parentUpdates[i:end]
			if err := postBulkToCPANEL(table, chunk); err != nil {
				log(fmt.Sprintf("Gagal kirim parent %s (%d baris): %s", table, len(chunk), err.Error()))
				continue
			}
			updated += len(chunk)
		}
		log(fmt.Sprintf("%s: %d relasi induk dikirim", table, updated))
	}

	if onBatch != nil {
		onBatch(processed, total)
	}

	log("Terkirim " + table + ": " + fmt.Sprintf("%d", sent))
	return sent
}

func fetchJSON(client *http.Client, url string) (map[string]interface{}, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Dapodik %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("respons Dapodik tidak valid: %w", err)
	}
	return out, nil
}
