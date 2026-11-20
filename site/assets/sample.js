// The sample that is on the page before a repository is analyzed: three screens of
// examples/react-app in the picky-eater repository, written by hand in the same format the
// analysis answers in.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NOTIFY = ['Shift reminders by email', 'Shift reminders by SMS', 'Push notifications', 'Schedule changes', 'Crew announcements', 'Weekly digest'];
const NAV = { t: 'nav', text: 'Switchback', items: ['Shifts', 'My hours', 'Settings'], style: 'bar' };

function settings(t) {
  const profile = { t: 'fields', items: ['Display name', 'Email', 'Phone'] };
  const emergency = { t: 'fields', items: ['Contact name', 'Contact phone'], cols: 2 };
  const availability = [{ t: 'area', text: 'days' }, { t: 'fields', items: ['Preferred trail difficulty', 'Max shift length'], cols: 2 }];
  const sections = (style) => [
    { t: 'section', text: 'Profile', style, children: [profile] },
    { t: 'section', text: 'Emergency contact', style, children: [emergency] },
    { t: 'section', text: 'Availability', items: ['Used to suggest shifts.'], style, children: availability },
    { t: 'section', text: 'Notifications', style, children: [{ t: 'area', text: 'notifications' }] },
  ];
  const lead = { t: 'choices', text: 'Reminder lead time', items: ['1 day'], style: 'select' };
  return {
    screen: { title: t('Settings', '설정'), file: 'src/pages/SettingsPage.tsx', summary: '' },
    page: [NAV, { t: 'heading', text: 'Settings' }, { t: 'area', text: 'sections' }, { t: 'area', text: 'save' }, { t: 'area', text: 'delete' }],
    areas: [
      { id: 'sections', label: t('How the sections are set apart', '섹션을 구분하는 방식'), decision: 'organize-settings', options: [
        { id: 'keep', keep: true, label: t('A line above each section', '섹션마다 위에 선 하나'), blocks: sections('line') },
        { id: 'cards', pattern: 'card', suggested: true, label: t('Each section in its own card', '섹션마다 카드 하나'),
          because: t('Four sections in one long form: a card around each shows where one ends.', '긴 폼에 섹션이 네 개라 카드로 묶으면 어디서 끝나는지 바로 보입니다.'),
          blocks: sections('card') },
        { id: 'side-titles', pattern: 'label-left', label: t('Titles on the left, fields on the right', '제목은 왼쪽, 입력란은 오른쪽'), blocks: sections('split') },
      ] },
      { id: 'days', label: t('Days you can volunteer', '봉사할 수 있는 요일'), decision: 'choose-several', options: [
        { id: 'keep', keep: true, label: t('Checkboxes in a row', '한 줄로 늘어선 체크박스'), blocks: [{ t: 'choices', text: 'Days you can volunteer', items: DAYS, style: 'checkbox' }] },
        { id: 'chips', pattern: 'toggle-button', suggested: true, label: t('A button for each day', '요일마다 버튼 하나'),
          because: t('Seven short labels read faster as buttons, and each is easier to hit on a phone.', '짧은 요일 이름 일곱 개는 버튼으로 두면 빨리 읽히고 휴대폰에서 누르기도 쉽습니다.'),
          blocks: [{ t: 'choices', text: 'Days you can volunteer', items: DAYS, style: 'chips' }] },
      ] },
      { id: 'notifications', label: t('Notification choices', '알림 설정'), decision: 'choose-several', options: [
        { id: 'keep', keep: true, label: t('One long list, lead time last', '긴 목록 하나, 알림 시간은 맨 아래'), blocks: [{ t: 'choices', items: NOTIFY, style: 'checkbox', cols: 1 }, lead] },
        { id: 'columns', pattern: 'checkbox-group', suggested: true, label: t('Two columns', '두 열로 나눈 목록'),
          because: t('Six options in two columns fit one glance instead of a scroll.', '여섯 항목을 두 열로 나누면 스크롤 없이 한눈에 들어옵니다.'),
          blocks: [{ t: 'choices', items: NOTIFY, style: 'checkbox', cols: 2 }, lead] },
        { id: 'lead-first', pattern: 'select', label: t('Lead time first, then the list', '알림 시간이 먼저, 목록은 그다음'), blocks: [lead, { t: 'choices', items: NOTIFY, style: 'checkbox', cols: 1 }] },
      ] },
      { id: 'save', label: t('Where Save sits', '저장 버튼 위치'), decision: 'save-settings', options: [
        { id: 'keep', keep: true, label: t('At the end of the form', '폼 맨 끝'), blocks: [{ t: 'buttons', items: ['Save changes'], style: 'left' }] },
        { id: 'sticky', pattern: 'sticky-save-bar', suggested: true, label: t('A bar that stays at the bottom', '화면 아래에 고정된 바'),
          because: t('The form is several screens long; a bar that stays keeps Save in reach wherever you edit.', '폼이 화면 몇 장 길이라 아래에 고정해 두면 어디를 고치든 저장 버튼이 손 닿는 곳에 있습니다.'),
          blocks: [{ t: 'buttons', items: ['Save changes'], style: 'sticky' }] },
      ] },
      { id: 'delete', label: t('Where Delete account lives', '계정 삭제 버튼 위치'), decision: 'confirm-destructive-action', options: [
        { id: 'keep', keep: true, label: t('Right after Save, as a plain button', '저장 바로 뒤, 일반 버튼'), blocks: [{ t: 'buttons', items: ['~Delete account'], style: 'left' }] },
        { id: 'danger-zone', pattern: 'destructive-button', suggested: true, label: t('In a section of its own, in red', '따로 떨어진 빨간 섹션'),
          because: t('Next to Save it is one slip away; apart and in red it cannot be pressed by mistake.', '저장 바로 옆에 있으면 실수로 누르기 쉽습니다. 따로 떼어 빨갛게 두면 잘못 누를 일이 없습니다.'),
          blocks: [{ t: 'section', text: 'Delete account', items: ['Removes your profile, shifts and logged hours. This cannot be undone.'], style: 'danger', children: [{ t: 'buttons', items: ['!Delete account'] }] }] },
        { id: 'typed', pattern: 'typed-confirmation', label: t('Type your email before it deletes', '이메일을 입력해야 삭제'),
          blocks: [{ t: 'buttons', items: ['~Delete account'], style: 'left' }, { t: 'dialog', text: 'Delete your account?', items: ['Type your email to confirm.', 'Cancel', '!Delete account'], style: 'modal' }] },
      ] },
    ],
  };
}

function shifts(t) {
  const columns = ['Date', 'Project', 'Time', 'Spots', 'Crew lead', ''];
  const head = { t: 'heading', text: 'Shifts', items: ['Upcoming work parties for your crew.'] };
  return {
    screen: { title: t('Shifts', '근무 일정'), file: 'src/pages/ShiftsPage.tsx', summary: '' },
    page: [NAV, { t: 'area', text: 'top' }, { t: 'area', text: 'list' }],
    areas: [
      { id: 'top', label: t('What the top of the page shows', '페이지 맨 위에 보여 줄 것'), decision: 'switch-views', options: [
        { id: 'keep', keep: true, label: t('A title and one line of text', '제목과 한 줄 설명'), blocks: [head] },
        { id: 'tabs', pattern: 'nav-tabs', suggested: true, label: t('Tabs for upcoming, yours and past', '예정, 내 신청, 지난 일정 탭'),
          because: t('People come back to check what they signed up for; a tab puts it one click away.', '신청해 둔 일정을 확인하러 다시 오는 사람이 많으니 탭으로 두면 한 번에 볼 수 있습니다.'),
          blocks: [head, { t: 'tabs', items: ['Upcoming', 'Signed up', 'Past'], style: 'underline' }] },
        { id: 'numbers', pattern: 'stat-tile', label: t('Three numbers at a glance', '한눈에 보는 숫자 세 개'), blocks: [head, { t: 'cards', items: ['Open shifts', 'Spots left', 'You signed up'], cols: 3, style: 'stat' }] },
      ] },
      { id: 'list', label: t('How the shifts are listed', '일정 목록 모양'), decision: 'show-a-collection', options: [
        { id: 'keep', keep: true, label: t('A table with six columns', '여섯 칸짜리 표'), blocks: [{ t: 'table', items: columns, n: 5 }] },
        { id: 'rows', pattern: 'list-row', suggested: true, label: t('Rows that start with the date', '날짜로 시작하는 줄 목록'),
          because: t('Six columns scroll sideways on a phone; a row keeps the date, the project and the button in view.', '여섯 칸짜리 표는 휴대폰에서 옆으로 밀어야 합니다. 줄 목록이면 날짜와 프로젝트, 버튼이 한 화면에 들어옵니다.'),
          blocks: [{ t: 'list', items: ['Sat 14 Jun · Ridge trail repair', 'Sun 15 Jun · Creek bridge', 'Sat 21 Jun · Switchback clearing', 'Sun 22 Jun · Trailhead signs'], style: 'divided' }] },
        { id: 'cards', pattern: 'card', label: t('A card for each shift', '일정마다 카드 하나'), blocks: [{ t: 'cards', items: ['Ridge trail repair', 'Creek bridge', 'Switchback clearing', 'Trailhead signs'], cols: 2, style: 'plain' }] },
      ] },
    ],
  };
}

function hours(t) {
  const columns = ['Date', 'Project', 'Hours', 'Status'];
  return {
    screen: { title: t('My hours', '내 봉사 시간'), file: 'src/pages/MyHoursPage.tsx', summary: '' },
    page: [NAV, { t: 'area', text: 'total' }, { t: 'area', text: 'list' }],
    areas: [
      { id: 'total', label: t('How the season total is shown', '시즌 합계를 보여 주는 방식'), decision: null, options: [
        { id: 'keep', keep: true, label: t('Inside a sentence', '문장 속에 넣은 합계'), blocks: [{ t: 'heading', text: 'My hours', items: ['24.5 hours logged this season. Crew leads approve hours after each shift.'] }] },
        { id: 'tiles', pattern: 'stat-tile', suggested: true, label: t('Three number tiles', '숫자 타일 세 개'),
          because: t('The total is the number people open this page for; in a sentence it is easy to miss.', '이 페이지는 합계 숫자를 보려고 여는데 문장 안에 있으면 놓치기 쉽습니다.'),
          blocks: [{ t: 'heading', text: 'My hours' }, { t: 'cards', items: ['Hours logged', 'Approved', 'Pending approval'], cols: 3, style: 'stat' }] },
      ] },
      { id: 'list', label: t('How the logged hours are listed', '기록 목록 모양'), decision: 'show-a-collection', options: [
        { id: 'keep', keep: true, label: t('A table with four columns', '네 칸짜리 표'), blocks: [{ t: 'table', items: columns, n: 5 }] },
        { id: 'rows', pattern: 'status-badge', suggested: true, label: t('Rows with the status as a label', '상태를 라벨로 붙인 줄 목록'),
          because: t('Approved or pending is what people scan for; a label on each row stands out more than a column of text.', '사람들이 찾는 건 승인 여부입니다. 줄마다 라벨로 붙이면 글자 열보다 눈에 잘 띕니다.'),
          blocks: [{ t: 'list', items: ['Ridge trail repair · 4.0 h', 'Creek bridge · 6.5 h', 'Switchback clearing · 5.0 h', 'Trailhead signs · 3.0 h'], style: 'divided' }] },
        { id: 'stacked', pattern: 'card', label: t('A card for each entry', '기록마다 카드 하나'), blocks: [{ t: 'table', items: columns, n: 3, style: 'stacked' }] },
      ] },
    ],
  };
}

export function sampleProject(lang) {
  const t = (en, ko) => (lang === 'ko' ? ko : en);
  const analyses = [settings(t), shifts(t), hours(t)];
  return {
    sample: true,
    repo: { owner: 'telicity-ai', name: 'picky-eater', ref: 'main', sub: 'examples/react-app' },
    stack: ['React 19', 'Vite', 'TypeScript', 'CSS tokens'],
    screens: analyses.map((analysis) => ({
      id: analysis.screen.file,
      path: analysis.screen.file,
      title: analysis.screen.title,
      status: 'ready',
      analysis,
    })),
  };
}
