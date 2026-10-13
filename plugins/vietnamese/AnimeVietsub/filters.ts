import { type Filters, FilterTypes } from '@libs/filterInputs';

export default {
  category: {
    type: FilterTypes.Picker,
    label: 'Thể loại',
    value: 'all',
    options: [
      { label: 'Tất cả', value: 'all' },
      { label: 'Anime lẻ (Movie/OVA)', value: 'list-le' },
      { label: 'Anime bộ (TV-Series)', value: 'list-bo' },
      { label: 'Anime Trọn Bộ', value: 'list-tron-bo' },
      { label: 'Anime Đang Chiếu', value: 'list-dang-chieu' },
      { label: 'Anime Sắp Chiếu', value: 'list-sap-chieu' },
    ],
  },
  genre: {
    type: FilterTypes.CheckboxGroup,
    label: 'Thể loại',
    value: [],
    options: [
      {
        label: 'Action',
        value: '1',
      },
      {
        label: 'Adventure',
        value: '2',
      },
      {
        label: 'Boys Love',
        value: '46',
      },
      {
        label: 'Cartoon',
        value: '44',
      },
      {
        label: 'Cổ Trang',
        value: '47',
      },
      {
        label: 'Comedy',
        value: '3',
      },
      {
        label: 'Dementia',
        value: '4',
      },
      {
        label: 'Demons',
        value: '5',
      },
      {
        label: 'Drama',
        value: '6',
      },
      {
        label: 'Ecchi',
        value: '7',
      },
      {
        label: 'Fantasy',
        value: '8',
      },
      {
        label: 'Game',
        value: '9',
      },
      {
        label: 'Harem',
        value: '10',
      },
      {
        label: 'Historical',
        value: '11',
      },
      {
        label: 'Horror',
        value: '12',
      },
      {
        label: 'Josei',
        value: '13',
      },
      {
        label: 'Kids',
        value: '14',
      },
      {
        label: 'Live Action',
        value: '43',
      },
      {
        label: 'Magic',
        value: '15',
      },
      {
        label: 'Martial Arts',
        value: '16',
      },
      {
        label: 'Mecha',
        value: '17',
      },
      {
        label: 'Military',
        value: '18',
      },
      {
        label: 'Music',
        value: '19',
      },
      {
        label: 'Mystery',
        value: '20',
      },
      {
        label: 'Parody',
        value: '21',
      },
      {
        label: 'Police',
        value: '22',
      },
      {
        label: 'Psychological',
        value: '23',
      },
      {
        label: 'Romance',
        value: '24',
      },
      {
        label: 'Samurai',
        value: '25',
      },
      {
        label: 'School',
        value: '26',
      },
      {
        label: 'Sci-Fi',
        value: '27',
      },
      {
        label: 'Seinen',
        value: '28',
      },
      {
        label: 'Shoujo',
        value: '29',
      },
      {
        label: 'Shoujo Ai',
        value: '30',
      },
      {
        label: 'Shounen',
        value: '31',
      },
      {
        label: 'Shounen Ai',
        value: '32',
      },
      {
        label: 'Slice of Life',
        value: '33',
      },
      {
        label: 'Space',
        value: '34',
      },
      {
        label: 'Sports',
        value: '35',
      },
      {
        label: 'Super Power',
        value: '36',
      },
      {
        label: 'Supernatural',
        value: '37',
      },
      {
        label: 'Suspense',
        value: '45',
      },
      {
        label: 'Thriller',
        value: '38',
      },
      {
        label: 'Tokusatsu',
        value: '42',
      },
      {
        label: 'Vampire',
        value: '39',
      },
      {
        label: 'Yaoi',
        value: '40',
      },
      {
        label: 'Yuri',
        value: '41',
      },
    ],
  },
  season: {
    type: FilterTypes.Picker,
    label: 'Season - Mùa',
    value: 'all',
    options: [
      { label: 'Tất cả', value: 'all' },
      { label: 'Mùa Đông', value: 'winter' },
      { label: 'Mùa Xuân', value: 'spring' },
      { label: 'Mùa Hạ', value: 'summer' },
      { label: 'Mùa Thu', value: 'autumn' },
    ],
  },
  year: {
    type: FilterTypes.Picker,
    label: 'Năm phát hành',
    value: 'all',
    options: [
      { label: 'Tất cả', value: 'all' },
      { label: '2026', value: '2026' },
      { label: '2025', value: '2025' },
      { label: '2024', value: '2024' },
      { label: '2023', value: '2023' },
      { label: '2022', value: '2022' },
      { label: '2021', value: '2021' },
      { label: '2020', value: '2020' },
      { label: '2019', value: '2019' },
      { label: '2018', value: '2018' },
      { label: '2017', value: '2017' },
      { label: '2016', value: '2016' },
      { label: '2015', value: '2015' },
      { label: '2014', value: '2014' },
      { label: '2013', value: '2013' },
      { label: 'Cũ hơn', value: 'older-2013' },
    ],
  },
  ageRating: {
    type: FilterTypes.Picker,
    label: 'Phân loại độ tuổi',
    value: 'all',
    options: [
      { label: 'Tất cả', value: 'all' },
      {
        label: '13+ - Teens 13 or older (3)',
        value: '13+ - Teens 13 or older',
      },
      { label: 'G - Mọi lứa tuổi (235)', value: 'G - Mọi lứa tuổi' },
      { label: 'None (689)', value: 'None' },
      { label: 'PG - Trẻ em (205)', value: 'PG - Trẻ em' },
      {
        label: 'PG-13 - Teens 13 tuổi trở lên (3540)',
        value: 'PG-13 - Teens 13 tuổi trở lên',
      },
      {
        label: 'R - 17+ (bạo lực và tục tĩu) (658)',
        value: 'R - 17+ (bạo lực và tục tĩu)',
      },
      {
        label: 'R+ - Dành cho 16 tuổi trở lên (380)',
        value: 'R+ - Dành cho 16 tuổi trở lên',
      },
      {
        label: 'R+ - Dành cho 17 tuổi trở lên (5)',
        value: 'R+ - Dành cho 17 tuổi trở lên',
      },
    ],
  },
  country: {
    type: FilterTypes.Picker,
    label: 'Quốc gia',
    value: 'all',
    options: [
      { label: 'Tất cả', value: 'all' },
      { label: 'Nhật Bản', value: 'jp' },
      { label: 'Trung Quốc', value: 'cn' },
      { label: 'Mỹ', value: 'us' },
      { label: 'Hàn Quốc', value: 'kr' },
      { label: 'Việt Nam', value: 'vietnam' },
      { label: 'Đài Loan', value: 'tw' },
    ],
  },
  sort: {
    type: FilterTypes.Picker,
    label: 'Sắp xếp',
    value: 'view',
    options: [
      { label: 'Mới nhất', value: 'latest' },
      { label: 'Tên A-Z', value: 'nameaz' },
      { label: 'Tên Z-A', value: 'nameza' },
      { label: 'Xem nhiều nhất', value: 'view' },
      { label: 'Nhiều lượt bình chọn', value: 'rating' },
    ],
  },
} satisfies Filters;
