# Dynamic Chart v1.0.0

Figma에서 `bar`, `line`, `stackedBar` 차트를 생성하고 수정하는 플러그인입니다.
현재 릴리스 기준 이름은 `Dynamic Chart 1.0`이고, `package.json` 버전은 `1.0.0`입니다.

## 1. TL;DR

- UI 엔트리: `src/ui/main.ts`
- Plugin 엔트리: `src/plugin/main.ts`
- 공유 타입: `src/shared/style-types.ts`
- HTML 구조: `src/ui/index.html`
- 전역 UI 상태: `src/ui/state.ts`
- 스타일 탭 오케스트레이션: `src/ui/style-tab.ts`
- Data preview 렌더: `src/ui/preview.ts`
- Export preview / 코드 생성 뷰: `src/ui/export.ts`
- 실제 Figma 노드 생성 및 수정: `src/plugin/drawing/*.ts`
- 저장/복원: `src/plugin/data-layer.ts`
- 스타일 추출: `src/plugin/style.ts`

핵심 구조는 단순합니다.

1. UI가 사용자의 데이터/옵션/스타일 입력을 상태로 관리합니다.
2. Data / Style / Export 탭은 같은 전역 상태를 공유합니다.
3. `generate` 또는 `apply` 시 UI가 payload를 만들어 Plugin으로 보냅니다.
4. Plugin이 선택된 Figma 노드를 해석하고 차트를 생성하거나 업데이트합니다.
5. 선택된 차트가 바뀌거나 스타일 추출이 필요하면 Plugin이 다시 UI에 snapshot을 보냅니다.

## 2. 제품 관점에서의 기능 요약

### 2.1 Data Tab

- 데이터 그리드 편집
- 행/열 추가 및 제거
- `raw` / `percent` 모드 전환
- `Y Min`, `Y Max` 설정
- Preview 헤더의 `소수점 표시` ON/OFF 토글
- Preview 헤더의 `guide line` ON/OFF 토글
- `guide line` min / max / avg / ctr 세부 토글
- CSV import / export

### 2.2 Style Tab

- `Templates` 섹션
- `Style Injection` 섹션
- 저장된 템플릿 적용 / 저장 / 이름 변경 / 삭제
- Paint Style 기반 색상 연결
- Preview hover 기반 스타일 대상 식별
- `Mark` 탭과 `Plot Area` 탭 기반 세부 스타일 주입
- `guide line` 스타일 카드와 Preview 헤더 토글 상태 동기화

### 2.3 Export Tab

- 현재 데이터/스타일 기준 preview 렌더
- Export용 코드 생성 결과 확인
- Data / Style preview와 동일한 축 폰트 및 시각 규칙 유지

## 3. 현재 UI에서 중요하게 바뀐 명칭

사용자 노출 텍스트와 내부 상태명이 항상 일치하는 것은 아닙니다.

- UI 표기 `guide line`
- 내부 상태/타입/파일명 `assistLine`
- UI 상위 탭 `Plot Area`
- UI 하위 카드명 `Border`

즉, 코드를 찾을 때는 `guide line` 대신 `assistLine`으로 검색해야 하는 경우가 많습니다.

## 4. 아키텍처

### 4.1 런타임 분리

- UI Runtime: `src/ui/*`
  - Figma plugin iframe 안에서 실행됩니다.
  - DOM, input, preview, style editor, export view를 담당합니다.
- Plugin Runtime: `src/plugin/*`
  - Figma document API를 직접 다룹니다.
  - 선택 노드 해석, 차트 생성/수정, pluginData 저장, 스타일 추출을 담당합니다.
- Shared: `src/shared/*`
  - UI와 Plugin이 공통으로 이해해야 하는 타입과 포맷을 정의합니다.

### 4.2 데이터 흐름

1. 사용자가 UI에서 데이터를 편집합니다.
2. `src/ui/state.ts`가 전역 상태를 유지합니다.
3. `src/ui/steps.ts`와 `src/ui/style-normalization.ts`가 payload를 만듭니다.
4. `src/ui/main.ts`가 Plugin으로 메시지를 보냅니다.
5. `src/plugin/main.ts`가 메시지를 받아 적절한 drawing 로직으로 위임합니다.
6. `src/plugin/data-layer.ts`가 pluginData와 local override를 저장합니다.
7. `src/plugin/style.ts`와 `src/plugin/init.ts`가 선택된 차트의 상태를 추출해 다시 UI에 보냅니다.

### 4.3 상태 레이어

상태는 크게 네 층으로 나뉩니다.

- 입력 상태
  - rows, cols, data, chartType, dataMode, y range 등
- 스타일 draft 상태
  - `styleInjectionDraft`, `markStylesDraft`, `markStrokeSidesByIndex`
- 추출 상태
  - 선택된 차트에서 읽어온 style snapshot
- 로컬 override 상태
  - 원본 추출값 위에 UI에서 덮어쓴 변경만 별도로 관리

이 구조 때문에, Style Tab은 단순 form이 아니라 "추출값 + 로컬 수정값"을 합성하는 레이어입니다.

## 5. 핵심 도메인 개념

### 5.1 Chart Type

- `bar`
- `line`
- `stackedBar`

차트 타입에 따라 grid 해석, preview 렌더 방식, Figma 노드 탐색 규칙, 스타일 적용 범위가 달라집니다.

### 5.2 Mark

`Mark`는 데이터 시리즈 단위의 시각 요소입니다.

- bar: 막대
- line: 라인/점
- stackedBar: segment를 포함한 막대 그룹

`markStylesDraft`는 row/series 단위 스타일을 담고 있습니다.

### 5.3 Plot Area

Style Injection의 `Plot Area`는 실제로 아래 요소를 묶는 영역입니다.

- `Background`
- `X-axis line`
- `Y-axis line`
- `Border`
- `guide line`

즉, 플롯 영역의 배경과 경계, 보조선 계열을 한곳에서 다룹니다.

### 5.4 guide line

사용자에게는 `guide line`으로 보이지만 내부 명칭은 `assist line`입니다.

guide line은 두 층의 상태를 가집니다.

- visible / enabled
  - Preview에서 보일지
  - 어떤 metric(min/max/avg/ctr)을 표시할지
- visual style
  - color
  - thickness
  - strokeStyle

### 5.5 Style Template

템플릿은 단순 색상 프리셋이 아니라, Style Injection payload 전체를 저장합니다.

- 공통 payload 또는 chartType별 payload 저장
- 썸네일 포함 저장 가능
- 적용 시 현재 draft에 merge됨

## 6. UI 탭별 코드 진입점

### 6.1 Data Tab

중점 파일:

- `src/ui/main.ts`
- `src/ui/grid.ts`
- `src/ui/data-ops.ts`
- `src/ui/mode.ts`
- `src/ui/y-range.ts`
- `src/ui/csv.ts`
- `src/ui/preview.ts`

관찰 포인트:

- grid 렌더와 데이터 편집은 `grid.ts`
- row/col 구조 조작은 `data-ops.ts`
- raw / percent 잠금 정책은 `mode.ts`
- preview guide line 헤더 토글은 `main.ts`
- preview 차트 SVG 렌더는 `preview.ts`

### 6.2 Style Tab

중점 파일:

- `src/ui/style-tab.ts`
- `src/ui/style-normalization.ts`
- `src/ui/style-popover.ts`
- `src/ui/style-templates.ts`
- `src/ui/preview.ts`

관찰 포인트:

- 스타일 탭의 오케스트레이션과 form sync는 `style-tab.ts`
- draft 읽기/검증/정규화는 `style-normalization.ts`
- 팝오버 UI는 `style-popover.ts`
- 템플릿 CRUD는 `style-templates.ts`
- style hover preview는 `preview.ts`

### 6.3 Export Tab

중점 파일:

- `src/ui/export.ts`

관찰 포인트:

- preview 렌더
- export 코드 표시
- style extract 결과 반영

## 7. Plugin 쪽 핵심 흐름

### 7.1 `src/plugin/main.ts`

Plugin 메시지 라우터입니다.

- `generate`
- `apply`
- `extract_style`
- paint style 관련 메시지
- template 관련 메시지

대부분의 디버깅은 여기서 시작하는 게 맞습니다.

### 7.2 `src/plugin/init.ts`

선택된 차트를 UI 초기 상태로 복원하는 역할을 합니다.

- selection 해석
- 저장된 pluginData 복원
- 추출 스타일과 로컬 override 합성
- `init` payload 작성

### 7.3 `src/plugin/data-layer.ts`

pluginData 저장/복원 레이어입니다.

- 마지막 적용값 저장
- local override 저장
- mark/color/style 관련 직렬화

### 7.4 `src/plugin/style.ts`

현재 선택된 차트의 스타일을 Figma 노드에서 추출합니다.

- mark style
- row/col stroke
- chart container stroke
- assist line stroke

Style Tab이 선택된 차트의 현재 스타일을 반영해야 할 때 이 파일이 중요합니다.

### 7.5 `src/plugin/template-store.ts`

스타일 템플릿 저장소입니다.

- load
- save
- overwrite
- rename
- delete

client storage key는 `styleTemplatesV1`입니다.

## 8. Drawing 레이어

`src/plugin/drawing/*`은 실제 Figma 노드를 업데이트하는 곳입니다.

### 파일별 역할

- `bar.ts`
  - bar 차트 그리기 및 업데이트
- `line.ts`
  - line 차트 그리기 및 업데이트
- `stacked.ts`
  - stacked bar 차트 그리기 및 업데이트
- `assist-line.ts`
  - guide line의 계산, 위치, 텍스트, 표시 상태 적용
- `stroke-injection.ts`
  - 셀/영역/가이드/마크 stroke 및 fill 스타일 동기화
- `line-structure.ts`
  - line 차트 구조 탐색 및 유효성 검사 보조
- `y-range.ts`
  - plugin 쪽 y 범위 계산
- `shared.ts`
  - 차트 공통 노드 탐색, col/legend/y-axis 접근 유틸

guide line 관련 수정은 `assist-line.ts`와 `stroke-injection.ts`를 같이 봐야 하는 경우가 많습니다.

## 9. 메시지 계약

### 9.1 UI -> Plugin

- `generate`
  - 새 차트 인스턴스를 생성하고 데이터/스타일을 적용
- `apply`
  - 선택된 기존 차트에 현재 상태를 적용
- `extract_style`
  - 선택된 차트의 스타일만 추출
- `resize`
  - UI 높이/너비 변경 알림
- `list_paint_styles`
  - 현재 문서의 Paint Style 목록 조회
- `create_paint_style`
  - 새 Paint Style 생성
- `rename_paint_style`
  - Paint Style 이름 변경
- `update_paint_style_color`
  - Paint Style 색상 갱신
- `load_style_templates`
  - 템플릿 목록 조회
- `save_style_template`
  - 템플릿 저장
- `rename_style_template`
  - 템플릿 이름 변경
- `delete_style_template`
  - 템플릿 삭제

### 9.2 Plugin -> UI

- `init`
  - 선택된 차트 기준으로 UI 초기 상태 전달
- `style_extracted`
  - 추출된 스타일 snapshot 전달
- `paint_styles_loaded`
  - Paint Style 목록 반환
- `paint_style_created`
  - Paint Style 생성 결과
- `paint_style_renamed`
  - Paint Style 이름 변경 결과
- `paint_style_updated`
  - Paint Style 색상 변경 결과
- `paint_style_error`
  - Paint Style 관련 오류
- `style_templates_loaded`
  - 템플릿 목록 반환
- `style_template_saved`
  - 템플릿 저장 결과
- `style_template_renamed`
  - 템플릿 이름 변경 결과
- `style_template_deleted`
  - 템플릿 삭제 결과
- `style_template_error`
  - 템플릿 관련 오류

## 10. 저장되는 데이터

저장 키 정의는 `src/plugin/constants.ts`의 `PLUGIN_DATA_KEYS`에 있습니다.

주요 키:

- `CHART_TYPE`
- `LAST_VALUES`
- `LAST_DRAWING_VALUES`
- `LAST_MODE`
- `LAST_CELL_COUNT`
- `LAST_MARK_NUM`
- `LAST_X_AXIS_LABELS`
- `LAST_Y_MIN`
- `LAST_Y_MAX`
- `LAST_Y_LABEL_FORMAT`
- `LAST_ROW_COLORS`
- `LAST_ROW_COLOR_MODES`
- `LAST_ROW_PAINT_STYLE_IDS`
- `LAST_COL_COLORS`
- `LAST_COL_COLOR_MODES`
- `LAST_COL_PAINT_STYLE_IDS`
- `LAST_COL_COLOR_ENABLED`
- `LAST_MARK_COLOR_SOURCE`
- `LAST_CORNER_RADIUS`
- `LAST_STROKE_WIDTH`
- `LAST_ASSIST_LINE_ENABLED`
- `LAST_ASSIST_LINE_VISIBLE`
- `LAST_ASSIST_LINE_STYLE`
- `LAST_MARK_STYLE`
- `LAST_MARK_STYLES`
- `LAST_LINE_BACKGROUND_STYLE`
- `LAST_ROW_HEADER_LABELS`
- `LAST_CELL_FILL_STYLE`
- `LAST_CELL_TOP_STYLE`
- `LAST_CELL_BOTTOM_STYLE`
- `LAST_TAB_RIGHT_STYLE`
- `LAST_GRID_CONTAINER_STYLE`
- `LAST_LOCAL_STYLE_OVERRIDES`
- `LAST_LOCAL_STYLE_OVERRIDE_MASK`

이 키들이 깨지면, 기존 차트 복원과 재편집 흐름이 바로 깨집니다.

## 11. 현재 중요한 동작 규칙

### 11.1 소수점 표시

UI 표기는 `소수점 표시`지만 내부 상태는 `yLabelFormat`입니다.

- `ON` -> `decimal`
- `OFF` -> `integer`

포맷 함수는 `src/shared/y-label-format.ts`에 있습니다.

### 11.2 guide line 상태 동기화

guide line 관련 UI는 여러 군데에 흩어져 있지만 같은 상태를 공유합니다.

- Data Tab Preview 헤더 토글
- Style Tab Preview 헤더 토글
- Style Injection > Plot Area > guide line 카드의 `Visible`

실제 state source는 `state.assistLineVisible`입니다.

### 11.3 Style Injection 카드 disabled 규칙

일부 카드는 `Visible` 체크가 꺼지면 카드 전체가 disabled처럼 보입니다.

- 카드 `opacity: 50%`
- 내부 입력 disabled
- 단, `Visible` 체크박스 자체는 항상 클릭 가능

이 동작은 `style-tab.ts`의 visible-controlled card sync 로직이 담당합니다.

### 11.4 mark side stroke 옵션

옵션 자체는 아직 state/model에 남아 있습니다.

- 내부 상태: 유지
- 카드 UI: 현재 숨김

즉, 기능이 삭제된 것이 아니라 노출만 막혀 있습니다.

## 12. 주요 파일별 역할

아래는 현재 저장소의 실제 파일 기준 설명입니다.

### 12.1 루트 파일

- `README.md`
  - 현재 문서
- `manifest.json`
  - Figma plugin 메타 정보
  - plugin name, entry, allowedDomains, relaunch button 정의
- `package.json`
  - npm 스크립트 및 개발 의존성
- `package-lock.json`
  - npm lock 파일
- `tsconfig.json`
  - TypeScript 컴파일 설정
- `vite.config.ui.ts`
  - UI 번들 전용 Vite 설정
  - Figma iframe 호환을 위해 single-file + `type="module"` 제거 처리 포함
- `vite.config.code.ts`
  - Plugin 런타임 번들 전용 Vite 설정
- `vite.config.ts`
  - 레거시/보조 Vite 설정
- `vite.config.js`
  - 레거시/보조 Vite 설정의 JS 버전
- `config.ts`
  - 과거 차트 컴포넌트 세트 명/variant 명칭 정의용 레거시 설정
- `config.js`
  - `config.ts`의 JS 버전
- `updateStyletab.md`
  - Style Tab 리팩토링 히스토리 문서
  - 모듈 분리 의도와 배경 이해에 도움 됨

### 12.2 `src/shared`

- `src/shared/style-types.ts`
  - UI와 Plugin이 공통으로 쓰는 타입 정의
  - stroke, mark style, assist line style, template payload, override mask 등 핵심 타입 포함
- `src/shared/y-label-format.ts`
  - Y label 포맷 타입과 포맷 함수
  - `integer` / `decimal` 처리

### 12.3 `src/plugin`

- `src/plugin/main.ts`
  - Plugin 엔트리
  - 메시지 라우팅과 명령 분기
- `src/plugin/init.ts`
  - 선택된 차트에서 초기 UI payload를 복원
- `src/plugin/data-layer.ts`
  - pluginData / local override 저장 및 읽기
- `src/plugin/style.ts`
  - Figma 노드에서 스타일 추출
- `src/plugin/template-store.ts`
  - style template 저장소 CRUD
- `src/plugin/constants.ts`
  - variant/property/storage key/regex 상수
- `src/plugin/utils.ts`
  - 공용 유틸 함수
  - 노드 탐색, 색상 처리, 이름 패턴 보조
- `src/plugin/log.ts`
  - plugin 디버그 로그 게이트
- `src/plugin/perf.ts`
  - 성능 측정용 보조 유틸

### 12.4 `src/plugin/drawing`

- `src/plugin/drawing/shared.ts`
  - 모든 차트 타입에서 재사용하는 공통 탐색 함수
- `src/plugin/drawing/y-range.ts`
  - plugin 쪽 y-range 계산
- `src/plugin/drawing/bar.ts`
  - bar 적용 로직
- `src/plugin/drawing/stacked.ts`
  - stacked bar 적용 로직
- `src/plugin/drawing/line-structure.ts`
  - line 차트 구조 유효성 검사
- `src/plugin/drawing/line.ts`
  - line 차트 적용 로직
- `src/plugin/drawing/assist-line.ts`
  - assist/guide line 배치 및 주입
- `src/plugin/drawing/stroke-injection.ts`
  - style injection 결과를 Figma stroke/fill에 반영

### 12.5 `src/ui`

- `src/ui/index.html`
  - 전체 UI 마크업
  - Data / Style / Export 탭과 popover DOM 정의
- `src/ui/style.css`
  - 전체 UI 스타일
- `src/ui/main.ts`
  - UI 엔트리
  - 메시지 수신, 전역 이벤트 바인딩, 탭 전환 연계
- `src/ui/state.ts`
  - 전역 상태와 기본값
- `src/ui/dom.ts`
  - DOM accessor 모음
  - 필수 요소 누락 시 에러를 던짐
- `src/ui/steps.ts`
  - generate/apply용 payload 빌드
- `src/ui/preview.ts`
  - Data / Style preview 렌더
  - mark/grid hover 상호작용 포함
- `src/ui/export.ts`
  - Export 탭 preview와 코드 뷰
- `src/ui/grid.ts`
  - Handsontable 기반 데이터 그리드 렌더/이벤트
- `src/ui/data-ops.ts`
  - 행/열/세그먼트 수 조작
- `src/ui/csv.ts`
  - CSV import/export
- `src/ui/mode.ts`
  - read/edit 모드와 raw/percent 모드 잠금 정책
- `src/ui/y-range.ts`
  - UI 쪽 y-range 계산과 검증
- `src/ui/log.ts`
  - UI 디버그 로그 게이트
- `src/ui/style-tab.ts`
  - Style Tab 진입점
  - 탭/섹션 상태, hydration, visible-controlled card, draft sync
- `src/ui/style-normalization.ts`
  - style form 값을 draft/payload로 정규화
- `src/ui/style-popover.ts`
  - 색상/스타일 popover
  - preview hover와 연결된 세부 편집 UI
- `src/ui/style-templates.ts`
  - 템플릿 갤러리 렌더와 CRUD 이벤트
- `src/ui/components/graph-setting-tooltip.ts`
  - Graph Setting 툴팁 컴포넌트

### 12.6 `src/ui/assets/tooltips`

- `cell-count.svg`
  - Cell Count 설명용 툴팁 이미지
- `column-width-ratio.svg`
  - Column Width Ratio 설명용 툴팁 이미지
- `graph-col.svg`
  - Graph Col 설명용 툴팁 이미지
- `mark-count.svg`
  - Mark Count 설명용 툴팁 이미지
- `segments.svg`
  - Segments 설명용 툴팁 이미지
- `thickness.svg`
  - Thickness 설명용 툴팁 이미지
- `y-max.svg`
  - Y Max 설명용 툴팁 이미지
- `y-min.svg`
  - Y Min 설명용 툴팁 이미지

### 12.7 기타

- `src/vite-env.d.ts`
  - TypeScript가 SVG 에셋을 모듈로 이해하도록 돕는 선언 파일

## 13. Project Structure

아래 트리는 현재 저장소의 실제 파일을 기준으로 정리한 것입니다.

```text
bro/
├─ README.md                              # 프로젝트 개요 및 구조 문서
├─ manifest.json                          # Figma plugin 메타 정보
├─ package.json                           # npm 스크립트/의존성
├─ package-lock.json                      # lock 파일
├─ tsconfig.json                          # TS 설정
├─ vite.config.ui.ts                      # UI 빌드 설정
├─ vite.config.code.ts                    # Plugin 빌드 설정
├─ vite.config.ts                         # 레거시/보조 Vite 설정
├─ vite.config.js                         # 레거시/보조 Vite 설정(JS)
├─ config.ts                              # 레거시 차트 설정
├─ config.js                              # 레거시 차트 설정(JS)
├─ updateStyletab.md                      # Style Tab 리팩토링 기록
└─ src/
   ├─ vite-env.d.ts                       # SVG 모듈 선언
   ├─ shared/
   │  ├─ style-types.ts                   # 공유 타입
   │  └─ y-label-format.ts                # Y 라벨 포맷 함수
   ├─ plugin/
   │  ├─ main.ts                          # Plugin 엔트리/메시지 라우팅
   │  ├─ init.ts                          # init payload 복원
   │  ├─ data-layer.ts                    # pluginData/local override 저장
   │  ├─ style.ts                         # Figma 스타일 추출
   │  ├─ log.ts                           # plugin debug logging
   │  ├─ perf.ts                          # 성능 측정 보조
   │  ├─ template-store.ts                # style template 저장소
   │  ├─ constants.ts                     # 상수/regex/storage key
   │  ├─ utils.ts                         # plugin 공용 유틸
   │  └─ drawing/
   │     ├─ shared.ts                     # 공용 노드 탐색 유틸
   │     ├─ y-range.ts                    # y-range 계산
   │     ├─ bar.ts                        # bar 차트 반영
   │     ├─ stacked.ts                    # stacked bar 차트 반영
   │     ├─ line-structure.ts             # line 구조 검증
   │     ├─ line.ts                       # line 차트 반영
   │     ├─ assist-line.ts                # guide line 반영
   │     └─ stroke-injection.ts           # style injection 적용
   └─ ui/
      ├─ index.html                       # UI 마크업 엔트리
      ├─ style.css                        # UI 스타일
      ├─ main.ts                          # UI 엔트리/메시지 수신
      ├─ state.ts                         # 전역 상태
      ├─ dom.ts                           # DOM accessor
      ├─ steps.ts                         # generate/apply payload 생성
      ├─ preview.ts                       # Data/Style preview 렌더
      ├─ export.ts                        # Export 탭 렌더/코드 뷰
      ├─ grid.ts                          # 데이터 그리드
      ├─ data-ops.ts                      # 행/열/세그먼트 조작
      ├─ csv.ts                           # CSV import/export
      ├─ mode.ts                          # read/edit + raw/percent 정책
      ├─ y-range.ts                       # UI y-range 계산
      ├─ log.ts                           # UI debug logging
      ├─ style-tab.ts                     # Style Tab orchestration
      ├─ style-normalization.ts           # style draft 정규화
      ├─ style-popover.ts                 # style popover
      ├─ style-templates.ts               # template gallery CRUD
      ├─ components/
      │  └─ graph-setting-tooltip.ts      # 그래프 설정 툴팁
      └─ assets/
         └─ tooltips/
            ├─ cell-count.svg             # Cell Count 툴팁 이미지
            ├─ column-width-ratio.svg     # Column Width Ratio 툴팁 이미지
            ├─ graph-col.svg              # Graph Col 툴팁 이미지
            ├─ mark-count.svg             # Mark Count 툴팁 이미지
            ├─ segments.svg               # Segments 툴팁 이미지
            ├─ thickness.svg              # Thickness 툴팁 이미지
            ├─ y-max.svg                  # Y Max 툴팁 이미지
            └─ y-min.svg                  # Y Min 툴팁 이미지
```

## 14. 변경할 때 먼저 보면 좋은 파일

### guide line 관련

- `src/ui/index.html`
- `src/ui/main.ts`
- `src/ui/style-tab.ts`
- `src/plugin/drawing/assist-line.ts`
- `src/plugin/style.ts`

### Style Injection 관련

- `src/ui/style-tab.ts`
- `src/ui/style-normalization.ts`
- `src/ui/style-popover.ts`
- `src/plugin/drawing/stroke-injection.ts`

### Data grid / preview 관련

- `src/ui/grid.ts`
- `src/ui/preview.ts`
- `src/ui/data-ops.ts`
- `src/ui/steps.ts`

### Export 관련

- `src/ui/export.ts`
- `src/ui/main.ts`
- `src/plugin/style.ts`

## 15. 개발 및 빌드

```bash
npm install
npm run build
npm run lint
```

산출물:

- `dist/index.html`
- `dist/code.js`

세부:

- `npm run build:ui`
  - `src/ui`를 `dist/index.html`로 번들
- `npm run build:code`
  - `src/plugin/main.ts`를 `dist/code.js`로 번들

## 16. 디버그 메모

기본적으로 디버그 로그는 게이트를 통해 제어됩니다.

- Plugin 디버그: `globalThis.__CHART_PLUGIN_DEBUG__ = true`
- UI 디버그: `window.__CHART_UI_DEBUG__ = true`

관련 파일:

- `src/plugin/log.ts`
- `src/ui/log.ts`

## 17. 문서를 읽는 사람에게 주는 추천 순서

처음 읽는다면 아래 순서가 가장 효율적입니다.

1. `src/ui/index.html`
2. `src/ui/main.ts`
3. `src/ui/state.ts`
4. `src/ui/style-tab.ts`
5. `src/ui/preview.ts`
6. `src/plugin/main.ts`
7. `src/plugin/init.ts`
8. `src/plugin/data-layer.ts`
9. `src/plugin/style.ts`
10. `src/plugin/drawing/*`

이 순서대로 보면 UI 입력이 어떻게 plugin payload로 바뀌고, 그 payload가 Figma 노드에 어떻게 반영되는지 흐름이 잡힙니다.
