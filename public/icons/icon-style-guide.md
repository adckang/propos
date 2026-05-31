# Scene-1 SVG Graphic Asset Guide

## 공통 스타일
- 배경: 투명 SVG, UI에서 필요 시 `bg-slate-950/50 + backdrop-blur` 원형 카드 안에 배치
- 기본 선색: `#F8FAFC` 또는 `#FFFFFF`
- 강조색: cyan `#22D3EE`, light cyan `#67E8F9`, brand blue `#1E6BFF`
- 선 굵기: 모바일 96px 기준 3~5px
- 선 끝: `stroke-linecap="round"`, `stroke-linejoin="round"`
- 권장 표시 크기: 모바일 76px 원형 카드 내부에 36~44px, PC는 88~104px 원형 카드 내부에 42~52px
- 애니메이션: SVG 자체보다 CSS/Framer Motion으로 opacity, scale, filter, drop-shadow 제어

## 파일별 용도
- `spacehost-logo.svg`: 히어로 상단 브랜드 로고. 실제 브랜드 로고 원본이 있으면 이 파일보다 원본을 우선 사용.
- `temp.svg`: 온도 최적화. 온도계 + 보조 눈금.
- `ventilation.svg`: 환기 완료. 팬 회전 형태.
- `music.svg`: 음악 재생. 음표 + 작은 음파.
- `light.svg`: 조명 은은하게. 전구 + 광선.
- `revenue-up.svg`: 좋은 리뷰/매출 상승 카드. 막대그래프 + 상승 화살표.

## 구현 주의
- 파란 웨이브 라인은 SVG 이미지로 고정하지 말고 CSS/motion.div로 구현한다.
- 아이콘 텍스트는 이미지에 넣지 말고 HTML로 렌더링한다.
- 로고 워드마크 텍스트는 SVG 내 text 요소이므로 실제 서비스에서는 폰트 로딩 차이에 따라 미세하게 달라질 수 있다. 브랜드 고정이 필요하면 path outline 로고를 따로 제작하는 것이 좋다.
