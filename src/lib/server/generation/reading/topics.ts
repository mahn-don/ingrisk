// Everyday topics for reading passages and writing prompts: situations a Vietnamese adult meets.

export interface Topic {
	id: string;
	/** For the LLM brief. */
	en: string;
	/** For the UI later (Phase 9). */
	vi: string;
}

export const TOPICS: readonly Topic[] = [
	{ id: 'food', en: 'food and cooking at home', vi: 'Ăn uống và nấu ăn' },
	{ id: 'eating-out', en: 'eating out: street food, cafés and restaurants', vi: 'Ăn ngoài: quán vỉa hè, quán cà phê, nhà hàng' },
	{ id: 'commuting', en: 'getting to work or school: motorbikes, buses and traffic', vi: 'Đi làm, đi học: xe máy, xe buýt, giao thông' },
	{ id: 'work', en: 'work, colleagues and the office', vi: 'Công việc, đồng nghiệp và văn phòng' },
	{ id: 'family', en: 'family life and relatives', vi: 'Gia đình và họ hàng' },
	{ id: 'friends', en: 'friends and free time together', vi: 'Bạn bè và thời gian rảnh' },
	{ id: 'phones', en: 'phones, apps and social media', vi: 'Điện thoại, ứng dụng và mạng xã hội' },
	{ id: 'health', en: 'health, sleep and visiting the doctor', vi: 'Sức khỏe, giấc ngủ và đi khám bệnh' },
	{ id: 'sport', en: 'exercise and sport', vi: 'Tập thể dục và thể thao' },
	{ id: 'weather', en: 'weather and seasons', vi: 'Thời tiết và các mùa' },
	{ id: 'shopping', en: 'shopping at markets, shops and online', vi: 'Mua sắm ở chợ, cửa hàng và trên mạng' },
	{ id: 'money', en: 'money, prices and saving', vi: 'Tiền bạc, giá cả và tiết kiệm' },
	{ id: 'travel', en: 'travel and holidays', vi: 'Du lịch và kỳ nghỉ' },
	{ id: 'study', en: 'studying and learning English', vi: 'Học tập và học tiếng Anh' },
	{ id: 'home', en: 'home, housework and neighbours', vi: 'Nhà cửa, việc nhà và hàng xóm' },
	{ id: 'city', en: 'life in the city and in the countryside', vi: 'Cuộc sống ở thành phố và nông thôn' },
	{ id: 'festivals', en: 'holidays and festivals such as Tết', vi: 'Lễ, Tết và các ngày hội' },
	{ id: 'hobbies', en: 'hobbies: music, films, books and games', vi: 'Sở thích: âm nhạc, phim, sách và trò chơi' },
	{ id: 'environment', en: 'the environment: rubbish, plastic and saving energy', vi: 'Môi trường: rác, nhựa và tiết kiệm năng lượng' },
	{ id: 'plans', en: 'plans, goals and the future', vi: 'Kế hoạch, mục tiêu và tương lai' }
];

export const topicById = (id: string): Topic | undefined => TOPICS.find((t) => t.id === id);
