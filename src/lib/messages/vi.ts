// Every user-facing string in the app lives here, grouped by screen.
// `.svelte` files must import from this module instead of containing literals
// (enforced heuristically by `npm run lint:strings`).

type Messages = { readonly [key: string]: string | Messages };

export const t = {
	app: {
		name: 'SilentEnglish',
		skipToContent: 'Bỏ qua, đến nội dung chính'
	},
	nav: {
		label: 'Điều hướng chính',
		home: 'Hôm nay',
		stats: 'Tiến độ',
		settings: 'Cài đặt'
	},
	login: {
		title: 'Đăng nhập',
		intro: 'Nhập mật khẩu để tiếp tục học.',
		password: 'Mật khẩu',
		submit: 'Đăng nhập',
		submitting: 'Đang kiểm tra…',
		wrong: 'Mật khẩu chưa đúng. Hãy thử lại.',
		tooMany: 'Bạn đã nhập sai quá nhiều lần. Hãy đợi khoảng 10 phút rồi thử lại.',
		insecure: 'Kết nối không mã hóa',
		insecureDetail: 'Trang đang dùng HTTP, không có HTTPS. Chỉ đăng nhập trên mạng bạn tin cậy.',
		notConfiguredTitle: 'Ứng dụng chưa được thiết lập',
		notConfigured:
			'Chưa có mật khẩu đăng nhập (APP_PASSWORD_HASH). Hãy tạo bằng lệnh npm run auth:hash, thêm vào tệp .env rồi khởi động lại máy chủ.'
	},
	home: {
		title: 'Hôm nay',
		greeting: 'Xin chào! Hôm nay mình học một chút nhé.',
		tagline: 'Đọc, viết, từ vựng và ngữ pháp tiếng Anh — mỗi ngày 5–10 phút, không cần âm thanh.',
		due: 'Thẻ cần ôn',
		newToday: 'Thẻ mới hôm nay',
		learning: 'Đang học',
		start: 'Bắt đầu học',
		startHint: 'Sẽ có ở Phase 9'
	},
	stats: {
		title: 'Tiến độ',
		emptyTitle: 'Chưa có số liệu',
		emptyBody: 'Sau vài buổi học, tiến độ của bạn sẽ hiện ở đây.'
	},
	settings: {
		title: 'Cài đặt',
		theme: 'Giao diện',
		themeSystem: 'Theo máy',
		themeLight: 'Sáng',
		themeDark: 'Tối',
		account: 'Tài khoản',
		logout: 'Đăng xuất'
	},
	session: {
		title: 'Buổi học',
		exit: 'Thoát buổi học',
		placeholderTitle: 'Chưa có buổi học',
		placeholderBody: 'Phần học sẽ có ở Phase 9.'
	},
	states: {
		loading: 'Đang tải…',
		errorTitle: 'Đã có lỗi xảy ra',
		retry: 'Thử lại',
		correct: 'Đúng',
		incorrect: 'Sai',
		selected: 'Đã chọn',
		progress: 'Tiến độ'
	},
	errorPage: {
		notFound: 'Không tìm thấy trang này.',
		generic: 'Đã có lỗi xảy ra. Hãy thử lại sau.',
		home: 'Về trang chủ'
	},
	dev: {
		title: 'Thành phần giao diện (chỉ khi phát triển)',
		light: 'Giao diện sáng',
		dark: 'Giao diện tối',
		buttons: 'Nút',
		primary: 'Nút chính',
		secondary: 'Nút phụ',
		ghost: 'Nút nhẹ',
		disabled: 'Không dùng được',
		loading: 'Đang xử lý',
		card: 'Thẻ',
		cardBody: 'Nội dung trong thẻ. Tiếng Việt có dấu: ệ ữ ặ ỗ ẫ ỹ.',
		progress: 'Thanh tiến độ',
		options: 'Lựa chọn',
		optionIdle: 'went',
		optionSelected: 'goes',
		optionCorrect: 'gone',
		optionIncorrect: 'going',
		textAnswer: 'Ô trả lời',
		textAnswerLabel: 'Viết câu trả lời của bạn',
		textAnswerPlaceholder: 'Gõ tiếng Anh ở đây',
		states: 'Trạng thái',
		reading: 'Đoạn đọc',
		readingSample:
			'Lan wakes up at six every morning. She drinks a cup of coffee and rides her motorbike to work. The streets of Hanoi are busy, but she likes the quiet hour before the city wakes up.',
		diacritics: 'Kiểm tra dấu: ệ ữ ặ ỗ ẫ ỹ — Nguyễn Thị Hường đã đọc sách ở thư viện.'
	}
} as const satisfies Messages;
