# video/ — Bộ dựng video ngắn 9:16 cho kênh Bác sĩ Chúc

Dựng video dọc 1080×1920 (Reels / Shorts / TikTok) kiểu chữ chuyển động
theo đúng nhận diện drchuc.com (navy – vàng – Be Vietnam Pro + Lora), có
giọng đọc, thanh tiến trình, cảnh kết kêu gọi theo dõi. Toàn bộ chạy bằng
lệnh, không cần phần mềm dựng phim.

Quy trình: **viết kịch bản JSON → có file giọng đọc → `node video/render.cjs`**.

## 1. Cài đặt (làm một lần)

```bash
cd video
npm i playwright && npx playwright install chromium   # trình duyệt để vẽ khung hình
pip install imageio-ffmpeg                            # ffmpeg (hoặc cài ffmpeg sẵn trên máy)
```

Cần Node 18+ và Python 3 (chỉ để lấy ffmpeg; nếu máy đã có `ffmpeg` thì bỏ qua).
Font Be Vietnam Pro + Lora (giấy phép OFL) tự tải về `video/fonts/` ở lần chạy đầu tiên (cần mạng).

## 2. Dựng video

```bash
# Duyệt bố cục trước: xuất ảnh PNG tại các mốc giây, không tốn thời gian dựng
node video/render.cjs video/kich-ban/demo-3-thoi-quen.json --preview 1.5,10,25,50

# Dựng thật, kèm giọng đọc
node video/render.cjs video/kich-ban/demo-3-thoi-quen.json --voice video/out/demo-3-thoi-quen/voice.mp3
```

Kết quả nằm trong `video/out/<tên kịch bản>/`:

| File | Dùng để |
|---|---|
| `video.mp4` | đăng lên kênh (H.264 + AAC, 30 fps, 1080×1920) |
| `thumb.jpg` | ảnh bìa |
| `phu-de.srt` | phụ đề tải kèm lên YouTube / Facebook |
| `timeline.json` | mốc thời gian từng cảnh (để kiểm tra khớp giọng đọc) |

Tuỳ chọn khác: `--fps 30`, `--crf 18` (nhỏ hơn = nét hơn), `--music nhac.mp3 --music-vol 0.12`, `--png` (chụp khung không mất nét, chậm hơn), `--out duong/dan/video.mp4`.

## 3. Viết kịch bản JSON

Xem mẫu đầy đủ: `kich-ban/demo-3-thoi-quen.json`. Mỗi cảnh có `style`, phần chữ
hiện trên hình và `voice` là câu đọc (dài hơn chữ trên hình cũng được).
Đặt `*từ khóa*` để tô vàng; giữ cụm tô vàng ngắn (dưới 4 từ) để không bị ngắt dòng.

| `style` | Trường | Dùng khi |
|---|---|---|
| `hook` | `lines[]` | câu mở đầu 2–3 giây giữ chân người xem, chữ rất to |
| `text` | `lines[]`, `kicker` (nhãn nhỏ phía trên) | nội dung thường |
| `point` | `number`, `title`, `desc`, `kicker` | từng ý trong danh sách (Thói quen 01, 02, …) |
| `stat` | `stat: {value, prefix, suffix, label}` | con số ấn tượng, chạy đếm lên |
| `quote` | `lines[]`, `who` | câu trích dẫn, chữ Lora nghiêng |
| `cta` | `cta: {title, sub, pill, socials[], monogram\|avatar}` | cảnh kết: theo dõi kênh, website |

Trường chung của kịch bản: `brand {name, tagline, site}`, `leadIn` (giây trống trước khi
giọng đọc bắt đầu, mặc định 0.3), `tail` (giữ cảnh kết thêm, mặc định 1.8), `thumbAt`
(mốc giây chụp ảnh bìa). Cảnh nào cũng có thể thêm `bg: "anh/ten.jpg"` (ảnh nền có hiệu ứng
zoom chậm, phủ tối cho dễ đọc) và cảnh `cta` nhận `avatar: "anh/chan-dung.jpg"` thay cho
chữ lồng `BSC`. Đường dẫn ảnh tính tương đối so với file kịch bản.

Nhịp khuyến nghị cho reel 45–60 giây: 8–10 cảnh, tổng phần `voice` khoảng 700–1000 ký tự,
mỗi dòng trên hình dưới 40 ký tự.

## 4. Giọng đọc

* **Tự thu bằng giọng thật của bác sĩ** (khuyến nghị – tốt nhất cho thương hiệu cá nhân và
  E-E-A-T): đọc lần lượt các câu `voice`, ngắt nghỉ rõ giữa các cảnh, xuất `.mp3` hoặc `.wav`
  rồi truyền qua `--voice`.
* **Giọng AI**: dùng vidIQ voiceover (qua Claude) hoặc bất kỳ dịch vụ TTS nào. Dán toàn bộ các
  câu `voice` nối bằng dòng trống; giữ dưới 1000 ký tự để tốn ít credit nhất.

Chương trình tự dò các khoảng lặng trong file giọng đọc để chuyển cảnh đúng lúc câu đọc
chuyển ý, nên nghỉ giữa các cảnh khoảng nửa giây là khớp tốt nhất.

## 5. Tái tạo một video từ reel tham khảo

1. Xem reel, ghi lại: câu hook, các ý chính theo thứ tự, câu chốt / kêu gọi hành động.
2. Viết lại bằng giọng của bác sĩ Chúc (không chép nguyên văn): thêm góc nhìn y khoa, ví dụ
   thực tế, kết bằng triết lý *sống khỏe – sống đẹp – sống có giá trị*.
3. Đổ vào JSON theo các `style` ở trên, duyệt `--preview`, thu giọng, dựng.

## Cấu trúc thư mục

```
video/
  render.cjs        lệnh dựng (Playwright chụp từng khung hình → ffmpeg H.264/AAC)
  template.html     khung hình 9:16, hàm __load(kịch bản, timeline) và __seek(giây)
  fonts/            Be Vietnam Pro, Lora – tự tải ở lần chạy đầu (không đưa lên git)
  kich-ban/         các kịch bản JSON
  out/              kết quả dựng (không đưa lên git)
```

Thư mục này không được deploy lên drchuc.com (đã ghi trong `.assetsignore`).
