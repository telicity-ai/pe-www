// The sample that is on the page before a repository is analyzed: three screens of
// examples/react-app in the picky-eater repository. Their markup and CSS are the app's own,
// captured from the running app (sample-data.js); the words are here, in both languages.
import { SAMPLE } from './sample-data.js';

// [English, Korean]; for a suggested option the reason follows.
const WORDS = {
  settings: {
    title: ['Settings', '설정'],
    areas: {
      sections: { decision: 'organize-settings', label: ['How the sections are set apart', '섹션을 구분하는 방식'], options: {
        keep: ['A line above each section', '섹션마다 위에 선 하나'],
        cards: ['Each section in its own card', '섹션마다 카드 하나',
          'Six sections in one long form: a card around each shows where one ends.', '긴 폼에 섹션이 여섯 개라 카드로 묶으면 어디서 끝나는지 바로 보입니다.'],
        'side-titles': ['Titles on the left, fields on the right', '제목은 왼쪽, 입력란은 오른쪽'],
      } },
      days: { decision: 'choose-several', label: ['Days you can volunteer', '봉사할 수 있는 요일'], options: {
        keep: ['Checkboxes in a row', '한 줄로 늘어선 체크박스'],
        chips: ['A button for each day', '요일마다 버튼 하나',
          'Seven short labels read faster as buttons, and each is easier to hit on a phone.', '짧은 요일 이름 일곱 개는 버튼으로 두면 빨리 읽히고 휴대폰에서 누르기도 쉽습니다.'],
      } },
      notifications: { decision: 'choose-several', label: ['Notification choices', '알림 설정'], options: {
        keep: ['One long list, lead time last', '긴 목록 하나, 알림 시간은 맨 아래'],
        columns: ['Two columns', '두 열로 나눈 목록',
          'Six options in two columns fit one glance instead of a scroll.', '여섯 항목을 두 열로 나누면 스크롤 없이 한눈에 들어옵니다.'],
        'lead-first': ['Lead time first, then the list', '알림 시간이 먼저, 목록은 그다음'],
      } },
      actions: { decision: 'confirm-destructive-action', label: ['Where Save and Delete sit', '저장과 삭제 버튼 위치'], options: {
        keep: ['Side by side at the end', '맨 끝에 나란히'],
        'danger-zone': ['Delete apart, in a red section', '삭제는 따로, 빨간 섹션에',
          'Next to Save, Delete is one slip away; apart and in red it cannot be pressed by mistake.', '삭제가 저장 바로 옆에 있으면 실수로 누르기 쉽습니다. 따로 떼어 빨갛게 두면 잘못 누를 일이 없습니다.'],
        sticky: ['Save stays at the bottom, Delete apart', '저장은 아래에 고정, 삭제는 따로'],
      } },
    },
  },
  shifts: {
    title: ['Shifts', '근무 일정'],
    areas: {
      top: { decision: 'switch-views', label: ['What the top of the page shows', '페이지 맨 위에 보여 줄 것'], options: {
        keep: ['A title and one line of text', '제목과 한 줄 설명'],
        tabs: ['Tabs for upcoming, yours and past', '예정, 내 신청, 지난 일정 탭',
          'People come back to check what they signed up for; a tab puts it one click away.', '신청해 둔 일정을 확인하러 다시 오는 사람이 많으니 탭으로 두면 한 번에 볼 수 있습니다.'],
        numbers: ['Three numbers at a glance', '한눈에 보는 숫자 세 개'],
      } },
      list: { decision: 'show-a-collection', label: ['How the shifts are listed', '일정 목록 모양'], options: {
        keep: ['A table with six columns', '여섯 칸짜리 표'],
        rows: ['Rows that start with the date', '날짜로 시작하는 줄 목록',
          'Six columns scroll sideways on a phone; a row keeps the date, the project and the button in view.', '여섯 칸짜리 표는 휴대폰에서 옆으로 밀어야 합니다. 줄 목록이면 날짜와 프로젝트, 버튼이 한 화면에 들어옵니다.'],
        cards: ['A card for each shift', '일정마다 카드 하나'],
      } },
    },
  },
  hours: {
    title: ['My hours', '내 봉사 시간'],
    areas: {
      total: { decision: null, label: ['How the season total is shown', '시즌 합계를 보여 주는 방식'], options: {
        keep: ['Inside a sentence', '문장 속에 넣은 합계'],
        tiles: ['Three number tiles', '숫자 타일 세 개',
          'The total is the number people open this page for; in a sentence it is easy to miss.', '이 페이지는 합계 숫자를 보려고 여는데 문장 안에 있으면 놓치기 쉽습니다.'],
      } },
      list: { decision: 'show-a-collection', label: ['How the logged hours are listed', '기록 목록 모양'], options: {
        keep: ['A table with four columns', '네 칸짜리 표'],
        rows: ['Rows with the status as a label', '상태를 라벨로 붙인 줄 목록',
          'Approved or pending is what people scan for; a label on each row stands out more than a column of text.', '사람들이 찾는 건 승인 여부입니다. 줄마다 라벨로 붙이면 글자 열보다 눈에 잘 띕니다.'],
        cards: ['A card for each entry', '기록마다 카드 하나'],
      } },
    },
  },
};

export function sampleProject(lang) {
  const pick = (words, from = 0) => words[from + (lang === 'ko' ? 1 : 0)];
  const assets = { css: [SAMPLE.css], tailwind: false, dark: false };
  return {
    sample: true,
    repo: { owner: 'telicity-ai', name: 'picky-eater', ref: 'main', sub: 'examples/react-app' },
    stack: ['React 19', 'Vite', 'TypeScript', 'CSS tokens'],
    screens: SAMPLE.screens.map((screen) => {
      const words = WORDS[screen.id];
      const title = pick(words.title);
      return {
        id: screen.file,
        path: screen.file,
        title,
        status: 'ready',
        assets,
        analysis: {
          screen: { title, file: screen.file },
          css: '',
          page: screen.page,
          areas: screen.areas.map((area) => {
            const text = words.areas[area.id];
            return {
              id: area.id,
              label: pick(text.label),
              decision: text.decision,
              options: area.options.map((option) => ({
                ...option,
                label: pick(text.options[option.id]),
                ...(option.suggested ? { because: pick(text.options[option.id], 2) } : {}),
              })),
            };
          }),
        },
      };
    }),
  };
}
