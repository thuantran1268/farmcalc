# FarmCalc – FCR và giá hòa vốn

Nhập email Japfa hợp lệ để vào ngay, không cần đăng ký, mật khẩu hoặc mã xác nhận. Mỗi email có bản nháp và tối đa 30 lần tính đã lưu trực tuyến. Người nhập cùng email trên thiết bị khác xem và sửa chung dữ liệu.

**Email là mã nhận diện, không xác thực người sở hữu.** Dữ liệu trên dịch vụ lưu là công khai cho người có thể dùng API của dự án; không nhập thông tin riêng tư hoặc bí mật.

## Kết nối dữ liệu trực tuyến

GitHub Pages chỉ phân phát trang web, không có chỗ ghi dữ liệu chung. Làm một lần trước khi đăng trang:

1. Tạo một dự án [Supabase](https://supabase.com/). Trong **SQL Editor**, chạy nội dung `schema.sql`. Bảng này cố ý cho phép khách không xác thực đọc, tạo và sửa dữ liệu.
2. Mở **Project Settings → API Keys**, lấy **Project URL** (`https://...supabase.co`) và **publishable key**. Điền vào `config.js`. Publishable key là khóa dành cho trình duyệt; tuyệt đối không dùng secret key hoặc service_role key.
3. Đăng nhập GitHub, tạo repository **Public**. Tải cả `index.html`, `auth.js`, `config.js`, `products.json`, `schema.sql`, `README.md` vào thư mục gốc và nhấn **Commit changes**.
4. Trong **Settings → Pages**, chọn **Deploy from a branch**, nhánh **main**, thư mục **/(root)** rồi **Save**.
5. Thử gõ một email theo mẫu, lưu một lần tính, mở cùng địa chỉ trên trình duyệt thứ hai và nhập lại email đó để kiểm tra dữ liệu xuất hiện.

Nếu chưa điền `config.js`, mở trực tiếp `index.html` vẫn vào được chế độ **chạy thử trên máy này**. Số liệu khi đó chỉ lưu trong trình duyệt của máy, không đồng bộ. Sau khi điền cấu hình, trang chuyển sang lưu trực tuyến theo email. Không cần dịch vụ gửi email hay hệ thống đăng ký.

## Cách tính

- Chi phí gồm giống, điện nước, vaccine và cám. Cám Japfa nhập thương hiệu, mã, giá bán/bao và số bao; cám đối thủ nhập tổng tiền và kg cám.
- Gà thịt: FCR theo kg xuất bán = tổng kg cám / tổng kg gà bán.
- Heo thịt: FCR đàn = tổng kg cám / (kg bán − kg toàn đàn lúc nhập).
- Giá hòa vốn = tổng bốn khoản chi phí / kg xuất bán hoặc số heo con cai sữa.

Danh mục giá nhúng trong `index.html` để tìm sản phẩm ngay khi mở trang; `products.json` lưu dữ liệu nguồn. Khi cập nhật bảng giá, cập nhật cả hai tệp.
