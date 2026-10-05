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
		startHint: 'Sẽ có ở Phase 9',
		placementTitle: 'Bạn đang ở trình độ nào?',
		placementBody: 'Làm một bài kiểm tra ngắn để ứng dụng chọn bài vừa sức với bạn. Có thể làm lại bất cứ lúc nào trong Cài đặt.',
		placementStart: 'Làm bài kiểm tra đầu vào (~10 phút)',
		placementSkip: 'Bỏ qua, bắt đầu từ cơ bản',
		resumeTitle: 'Bài kiểm tra đang làm dở',
		resumeBody: 'Bạn có thể tiếp tục từ chỗ đã dừng.',
		resume: 'Tiếp tục bài kiểm tra',
		level: 'Trình độ ước tính: {cefr}'
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
		logout: 'Đăng xuất',
		placement: 'Bài kiểm tra đầu vào',
		placementLast: 'Kết quả gần nhất: {cefr} (ngày {date})',
		placementNone: 'Bạn chưa làm bài kiểm tra đầu vào.',
		placementSeeResult: 'Xem kết quả',
		placementRetake: 'Làm lại bài kiểm tra',
		placementTake: 'Làm bài kiểm tra'
	},
	session: {
		title: 'Buổi học',
		exit: 'Thoát buổi học',
		placeholderTitle: 'Chưa có buổi học',
		placeholderBody: 'Phần học sẽ có ở Phase 9.'
	},
	placement: {
		title: 'Bài kiểm tra đầu vào',
		exit: 'Thoát bài kiểm tra',
		exitTitle: 'Thoát bài kiểm tra?',
		exitBody: 'Bài làm của bạn đã được lưu. Bạn có thể tiếp tục sau từ trang Hôm nay.',
		exitConfirm: 'Thoát',
		exitCancel: 'Ở lại làm tiếp',
		welcomeBody:
			'Khoảng 10 phút, gồm 3 phần: nhận biết từ vựng, chọn từ điền vào câu và viết vài câu. Kết quả giúp ứng dụng chọn bài vừa sức với bạn.',
		welcomeNote: 'Hãy làm một mình, không tra từ điển. Kết quả chỉ là ước tính.',
		begin: 'Bắt đầu',
		beginPart: 'Bắt đầu phần này',
		part: 'Phần {n}/3',
		partProgress: 'Tiến độ phần {n}',
		error: 'Không gửi được câu trả lời. Hãy kiểm tra kết nối rồi thử lại.',
		stale: 'Bài kiểm tra đã thay đổi (có thể ở một thẻ khác). Đã tải lại câu hiện tại.',
		partA: {
			name: 'Từ vựng',
			introTitle: 'Phần 1: Bạn có biết từ này?',
			introBody: 'Mỗi lần hiện một từ tiếng Anh. Chọn “Biết” nếu bạn biết nghĩa của từ, “Không biết” nếu không.',
			introWarning:
				'Lưu ý: một số từ là từ bịa, không có thật. Đừng đoán — chọn “Biết” cho từ không có thật sẽ làm kết quả kém chính xác.',
			question: 'Bạn có biết nghĩa của từ này không?',
			known: 'Biết',
			unknown: 'Không biết'
		},
		partB: {
			name: 'Điền từ',
			introTitle: 'Phần 2: Chọn từ đúng',
			introBody: 'Mỗi câu có một chỗ trống. Chọn từ phù hợp nhất. Bạn sẽ không thấy đúng hay sai trong lúc làm.',
			question: 'Chọn từ phù hợp cho chỗ trống',
			gap: 'chỗ trống',
			noWord: '(không cần từ nào)'
		},
		partC: {
			name: 'Viết',
			introTitle: 'Phần 3: Viết vài câu',
			introBody: 'Viết bằng tiếng Anh theo đề bài. Không cần hoàn hảo, hãy viết như bình thường. Bạn có thể bỏ qua phần này.',
			clozeSkipped: 'Phần 2 đã được bỏ qua vì ứng dụng chưa đủ câu hỏi.',
			label: 'Bài viết của bạn (bằng tiếng Anh)',
			hint: 'Gợi ý',
			words: '{n} từ',
			target: 'nên viết {min}–{max} từ',
			submit: 'Nộp bài',
			grading: 'Đang chấm bài viết… (tối đa 30 giây)',
			skip: 'Bỏ qua phần viết'
		},
		result: {
			title: 'Kết quả bài kiểm tra',
			level: 'Trình độ ước tính',
			equivalents: 'Tương đương (ước tính)',
			vstep: 'VSTEP',
			vstepValue: 'Bậc {n}',
			ielts: 'IELTS',
			toeic: 'TOEIC (Nghe & Đọc)',
			belowScale: 'Chưa đến mức thấp nhất',
			details: 'Chi tiết',
			vocab: 'Từ vựng: bạn nhận biết tốt các từ thông dụng đến nhóm {band}/8.',
			lexical: 'Nghĩa của từ trong câu: đúng {correct}/{total} câu.',
			grammar: 'Ngữ pháp: đúng {correct}/{total} câu',
			article: 'mạo từ',
			preposition: 'giới từ',
			verb_form: 'dạng động từ',
			clozeSkipped: 'Phần điền từ chưa làm: ứng dụng chưa đủ câu hỏi. Kết quả dựa trên từ vựng.',
			falseAlarms:
				'Bạn chọn “Biết” cho nhiều từ không có thật, nên kết quả từ vựng có thể chưa chính xác và đã được giới hạn ở mức cơ bản.',
			writingScored: 'Bài viết: trình độ {cefr}.',
			writingQueued: 'Bài viết của bạn sẽ được chấm sau. Kết quả sẽ tự cập nhật khi chấm xong.',
			writingNone: 'Bạn đã bỏ qua phần viết.',
			previous: 'So với lần trước',
			previousValue: 'Ngày {date}: {cefr}',
			up: 'Tăng',
			down: 'Giảm',
			same: 'Không đổi',
			first: 'Đây là lần kiểm tra đầu tiên của bạn.',
			caveat:
				'Đây chỉ là ước tính để chọn bài học phù hợp, không phải điểm thi hay chứng chỉ chính thức. Ứng dụng chỉ kiểm tra đọc và viết, không kiểm tra nghe và nói.',
			home: 'Về trang Hôm nay'
		}
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
