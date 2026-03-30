# Dynamic Chart (Figma Plugin)

Figma에서 `bar`, `line`, `stackedBar` 차트를 생성/수정하는 플러그인입니다.

- 기준일: 2026-03-30
- 릴리스 이름: `Dynamic Chart 1.1` (`manifest.json`)
- 패키지 버전: `1.0.0` (`package.json`)

## 1. TL;DR

- UI 엔트리: `src/ui/main.ts`
- Plugin 엔트리: `src/plugin/main.ts`
- 차트 적용 핵심: `src/plugin/drawing/bar.ts`, `src/plugin/drawing/line.ts`, `src/plugin/drawing/stacked.ts`
- 스타일 주입/동기화 핵심: `src/plugin/drawing/stroke-injection.ts`, `src/ui/style-tab.ts`
- 상태 저장/복원: `src/plugin/data-layer.ts`, `src/plugin/init.ts`
- Export 렌더/코드: `src/ui/export.ts`
- 공유 타입: `src/shared/style-types.ts`

## 2. 현재 업데이트 기준 핵심 기능

- 멀티 차트 선택 대응: 선택된 차트 목록에서 `◀/▶`로 타깃 전환 (`select_chart_target`)
- 탭별 스타일 추출 분리: Style 탭/Export 탭이 목적별로 `request_style_extract` 수행
- Style 적용 분리: `updateType = data | style | both`
- Variable 빠른 동기화: `update_variables_only` 경로로 변수 값만 갱신
- Variable 업데이트 모드: `overwrite` / `create`
- 라인 차트 옵션 분리: `line point`, `curve`, `area` 토글
- 바 차트 라벨 소스 분리: `row` / `y값`
- Stacked 전용 규칙 강화:
  - Group Count + Segments 구조
  - Row 0(`All`) 빈 셀 자동 합계 fallback
  - 합계 초과 시 validation 및 Apply 차단

## 3. 차트별 기능 매트릭스

| 차트 | 데이터 구조 | 주요 시각 옵션 | 스타일/주입 포인트 | 핵심 파일 |
|---|---|---|---|---|
| `bar` | rows x cols | Mark Count, Column Width Ratio, Bar Label(`row/y`) | mark fill/stroke, col 색상 override, guide line | `src/plugin/drawing/bar.ts`, `src/ui/preview.ts` |
| `line` | rows x (cols+1) | Stroke Width, line point, curve(lineFeature2), area(line background) | mark stroke/point/area, line bundle 구조 검증 | `src/plugin/drawing/line.ts`, `src/plugin/drawing/line-structure.ts` |
| `stackedBar` | groupStructure 기반(그룹별 세그먼트 수) | Group Count, Segments, Column Width Ratio | 세그먼트별 fill/stroke, 그룹별 폭/간격, 합계 검증 | `src/plugin/drawing/stacked.ts`, `src/ui/data-ops.ts` |

### 3.1 공통 옵션

- 축 표시: `xAxisLabelsVisible`, `yAxisVisible`
- guide line: `assistLineVisible`, `assistLineEnabled(min/max/avg/ctr)`
- Y 범위/라벨 포맷: `yMin`, `yMax`, `yLabelFormat(integer/decimal)`
- row/col 색상 소스: `markColorSource(row/col)`

## 4. 탭별 역할

### 4.1 Data Tab (`step-2`)

역할: 차트 데이터 모델을 만들고 검증하는 탭

- Chart Type 선택(1단계) 후 Graph Setting + Data Setting 수행
- 데이터 그리드 편집(행/열/그룹/세그먼트 조작)
- Preview에서 즉시 시각 확인
- Preview 제어:
  - 축 표시 + 소수점 표시
  - line option(line point/curve/area)
  - bar label 표시/소스
  - guide line 표시/지표(min/max/avg/ctr)
- CSV 업로드/내보내기

주요 파일:

- `src/ui/grid.ts`
- `src/ui/data-ops.ts`
- `src/ui/mode.ts`
- `src/ui/y-range.ts`
- `src/ui/csv.ts`
- `src/ui/preview.ts`

### 4.2 Style Tab (`step-style`)

역할: 스타일 템플릿 관리 + 스타일 주입 편집

- 상단 Preview와 Style 카드 hover/click 연동
- 섹션 1: `Templates`
  - 템플릿 저장/수정/삭제/덮어쓰기
  - chartType 스코프별 payload 병합
- 섹션 2: `Style Setting`
  - 하위 탭 `Mark` / `Plot Area`
  - `Mark`:
    - Stroke/Fill
    - line point, line area(line 전용)
    - mark index별 스타일
  - `Plot Area`:
    - Background
    - X-axis line
    - Y-axis line
    - Border
    - guide line
- `Variable Mode`:
  - `overwrite`: 기존 변수 슬롯 우선 사용
  - `create`: 슬롯별 로컬 변수 생성/재바인딩

주요 파일:

- `src/ui/style-tab.ts`
- `src/ui/style-normalization.ts`
- `src/ui/style-popover.ts`
- `src/ui/style-templates.ts`
- `src/ui/mark-variable.ts`
- `src/ui/variable-display.ts`

### 4.3 Export Tab (`step-export`)

역할: 현재 데이터/스타일을 기반으로 D3 미리보기와 코드 확인

- 탭 진입 시 `request_style_extract(reason='export_tab')`
- Export 전용 payload로 Preview 렌더
- 코드 생성 결과 복사
- Data/Style draft를 직접 변형하지 않고 조회 중심으로 동작

주요 파일:

- `src/ui/export.ts`

## 5. 런타임/데이터 흐름

### 5.1 런타임 분리

- UI Runtime: `src/ui/*`
  - 사용자 입력, 탭 전환, 상태 관리, D3 preview
- Plugin Runtime: `src/plugin/*`
  - Figma node 읽기/쓰기, 차트 생성/수정, pluginData 저장
- Shared: `src/shared/*`
  - UI/Plugin 공통 타입, 포맷

### 5.2 표준 처리 흐름

1. UI 상태 변경 (`src/ui/state.ts`)
2. 제출 payload 생성 (`src/ui/steps.ts`)
3. Plugin 명령 처리 (`src/plugin/main.ts`)
4. 차트 데이터/스타일 적용 (`src/plugin/drawing/*`)
5. 저장(`pluginData`) + UI sync (`src/plugin/data-layer.ts`, `src/plugin/init.ts`)

### 5.3 Apply 정책

- `generate`: 신규 인스턴스 생성 후 `both` 적용
- `apply`: 선택 타깃에 `data/style/both` 적용
- 인스턴스 타깃은 local style override 우선 처리

## 6. 메시지 계약 (요약)

### 6.1 UI -> Plugin

- `generate`
- `apply`
- `update_variables_only`
- `request_style_extract`
- `extract_style`(legacy)
- `select_chart_target`
- `list_paint_styles`
- `list_color_variables`
- `create_paint_style`
- `rename_paint_style`
- `update_paint_style_color`
- `update_color_variable`
- `load_style_templates`
- `save_style_template`
- `overwrite_style_template`
- `rename_style_template`
- `delete_style_template`
- `ui_perf_init_ack`
- `resize`

### 6.2 Plugin -> UI

- `init`
- `style_extracted`
- `preview_plot_size_updated`
- `variables_only_applied`
- `variables_only_requires_style_apply`
- `apply_completed`
- `apply_cancelled`
- `paint_styles_loaded`
- `color_variables_loaded`
- `paint_style_created`
- `paint_style_renamed`
- `paint_style_updated`
- `paint_style_error`
- `color_variable_updated`
- `color_variable_error`
- `style_templates_loaded`
- `style_template_saved`
- `style_template_overwritten`
- `style_template_renamed`
- `style_template_deleted`
- `style_template_error`

## 7. 저장 데이터

### 7.1 pluginData 키

정의 위치: `src/plugin/constants.ts` -> `PLUGIN_DATA_KEYS`

핵심 그룹:

- 차트/데이터: `CHART_TYPE`, `LAST_VALUES`, `LAST_DRAWING_VALUES`, `LAST_MODE`, `LAST_MARK_NUM`
- 축/라벨: `LAST_X_AXIS_LABELS`, `LAST_X_AXIS_LABELS_VISIBLE`, `LAST_Y_AXIS_VISIBLE`, `LAST_Y_LABEL_FORMAT`
- 바/라인 옵션: `LAST_BAR_LABEL_VISIBLE`, `LAST_BAR_LABEL_SOURCE`, `LAST_LINE_POINT_VISIBLE`, `LAST_LINE_CURVE_ENABLED`
- guide line: `LAST_ASSIST_LINE_VISIBLE`, `LAST_ASSIST_LINE_ENABLED`, `LAST_ASSIST_LINE_STYLE`
- 색상/스타일: `LAST_ROW_COLORS`, `LAST_COL_COLORS`, `LAST_MARK_STYLE`, `LAST_MARK_STYLES`, `LAST_GRID_CONTAINER_STYLE` 등
- 변수 슬롯: `LAST_MARK_VARIABLE_SLOT_MAP`
- 인스턴스 로컬 오버라이드: `LAST_LOCAL_STYLE_OVERRIDES`, `LAST_LOCAL_STYLE_OVERRIDE_MASK`

### 7.2 clientStorage 키

- `styleTemplatesV1` (`CLIENT_STORAGE_KEYS.STYLE_TEMPLATES`)

## 8. 파일별 역할 맵

### 8.1 루트

| 파일 | 역할 |
|---|---|
| `README.md` | 프로젝트 운영 문서 |
| `manifest.json` | Figma 플러그인 메타/엔트리/네트워크 권한 |
| `package.json` | 스크립트/의존성 |
| `package-lock.json` | lock 파일 |
| `tsconfig.json` | TS 컴파일 설정 |
| `vite.config.ui.ts` | UI 번들 설정 |
| `vite.config.code.ts` | Plugin 번들 설정 |
| `vite.config.ts` | 레거시/보조 Vite 설정 |
| `vite.config.js` | 레거시/보조 Vite 설정(JS) |
| `config.ts` | 레거시 차트 설정 상수 |
| `config.js` | `config.ts` JS 버전 |
| `updateStyletab.md` | Style 탭 리팩토링 기록 |

### 8.2 문서/산출물

| 파일/폴더 | 역할 |
|---|---|
| `docs/line-component-usage-guide-example.md` | 라인 컴포넌트 사용 가이드 예시 |
| `dist/` | 빌드 산출물(`index.html`, `code.js`) |

### 8.3 Shared

| 파일 | 역할 |
|---|---|
| `src/shared/style-types.ts` | UI/Plugin 공통 타입(주입 payload, override mask, template 타입) |
| `src/shared/y-label-format.ts` | Y 라벨 포맷(`integer/decimal`) |
| `src/vite-env.d.ts` | SVG 모듈 타입 선언 |

### 8.4 Plugin Core (`src/plugin`)

| 파일 | 역할 |
|---|---|
| `main.ts` | Plugin 메인 메시지 라우터/적용 파이프라인 |
| `init.ts` | 선택 노드 해석 + UI 초기화 payload 생성 |
| `data-layer.ts` | pluginData 저장/복원 + 로컬 override 정규화 |
| `style.ts` | 선택 차트 스타일 추출 |
| `template-store.ts` | 스타일 템플릿 CRUD + payload 정규화 |
| `constants.ts` | 상수/키/패턴 정의 |
| `utils.ts` | 플러그인 공용 유틸 |
| `loading.ts` | 적용 중 로딩 opacity 처리 |
| `perf.ts` | apply 성능 측정/로그 |
| `log.ts` | 디버그 로그 게이트 |

### 8.5 Drawing (`src/plugin/drawing`)

| 파일 | 역할 |
|---|---|
| `bar.ts` | bar 차트 렌더/색상/라벨/ratio 적용 |
| `line.ts` | line 차트 렌더, point/curve/area, 구조 검증 기반 적용 |
| `line-structure.ts` | line bundle 탐색/검증/matrix 구성 |
| `stacked.ts` | stacked bar 렌더, 그룹/세그먼트 폭/가시성 처리 |
| `assist-line.ts` | guide line 계산/표시/스타일 적용 |
| `stroke-injection.ts` | 스타일 주입 payload를 실제 stroke/fill에 반영 |
| `mark-variables.ts` | mark 스타일과 Figma variable 바인딩 |
| `shared.ts` | 컬럼 수집/축/레이아웃 공용 처리 |
| `y-range.ts` | y-domain 계산 |

### 8.6 UI Core (`src/ui`)

| 파일 | 역할 |
|---|---|
| `index.html` | 탭/패널/팝오버 마크업 |
| `main.ts` | UI 엔트리, 이벤트 바인딩, plugin 메시지 처리 |
| `state.ts` | 전역 상태 + 기본값 + 길이 보정 유틸 |
| `dom.ts` | 필수 DOM accessor(lazy getter) |
| `steps.ts` | generate/apply/update_variables_only payload 생성 |
| `mode.ts` | raw/percent/read-edit 정책 + validation |
| `data-ops.ts` | 행/열/그룹/세그먼트 조작 |
| `grid.ts` | 데이터 그리드 렌더/입력 처리 |
| `csv.ts` | CSV import/export |
| `preview.ts` | Data/Style 탭 D3 preview 렌더 |
| `export.ts` | Export 탭 D3 preview + 코드 출력 |
| `y-range.ts` | UI y-domain 계산/검증 |
| `log.ts` | UI 디버그 로그 게이트 |
| `style.css` | UI 스타일 |

### 8.7 UI Style 계층

| 파일 | 역할 |
|---|---|
| `style-tab.ts` | Style 탭 오케스트레이션(탭/카드/동기화) |
| `style-normalization.ts` | 스타일 draft 정규화 + payload 변환 |
| `style-popover.ts` | 스타일 편집 팝오버 상태/동작 |
| `style-templates.ts` | 템플릿 갤러리 렌더/편집 |
| `mark-variable.ts` | mark 입력 필드 <-> variable slot 매핑 |
| `variable-display.ts` | variable 표시명 포맷팅 |
| `components/graph-setting-tooltip.ts` | Graph Setting 툴팁 컴포넌트 |

### 8.8 UI 에셋

| 파일 | 역할 |
|---|---|
| `src/ui/assets/tooltips/cell-count.svg` | Cell Count 설명 이미지 |
| `src/ui/assets/tooltips/column-width-ratio.svg` | Column Width Ratio 설명 이미지 |
| `src/ui/assets/tooltips/graph-col.svg` | Graph Col 설명 이미지 |
| `src/ui/assets/tooltips/mark-count.svg` | Mark Count 설명 이미지 |
| `src/ui/assets/tooltips/segments.svg` | Segments 설명 이미지 |
| `src/ui/assets/tooltips/thickness.svg` | Thickness 설명 이미지 |
| `src/ui/assets/tooltips/y-min.svg` | Y Min 설명 이미지 |
| `src/ui/assets/tooltips/y-max.svg` | Y Max 설명 이미지 |

## 9. 유지보수 빠른 가이드

### 9.1 변경 시 진입점

- 차트 적용 로직 변경: `src/plugin/main.ts` + `src/plugin/drawing/*.ts`
- guide line 변경: `src/ui/main.ts`, `src/ui/style-tab.ts`, `src/plugin/drawing/assist-line.ts`, `src/plugin/style.ts`
- line 옵션 변경(point/curve/area): `src/ui/main.ts`, `src/ui/preview.ts`, `src/plugin/drawing/line.ts`
- stacked 데이터 규칙 변경: `src/ui/data-ops.ts`, `src/ui/mode.ts`, `src/plugin/drawing/stacked.ts`
- 템플릿 저장 규칙 변경: `src/ui/style-templates.ts`, `src/plugin/template-store.ts`
- variable 동기화 변경: `src/ui/mark-variable.ts`, `src/plugin/drawing/mark-variables.ts`, `src/plugin/main.ts`
- Export 결과 변경: `src/ui/export.ts`, `src/plugin/style.ts`

### 9.2 용어 주의

- UI 표기: `guide line`
- 내부 코드명: `assistLine` / `assist-line.ts`

검색 시 `guide line`과 `assistLine`을 모두 확인하는 것이 안전합니다.

## 10. 개발/빌드

```bash
npm install
npm run build
npm run lint
```

세부:

- `npm run build:ui` -> `dist/index.html`
- `npm run build:code` -> `dist/code.js`

## 11. 디버그 플래그

- Plugin 디버그: `globalThis.__CHART_PLUGIN_DEBUG__ = true`
- UI 디버그: `window.__CHART_UI_DEBUG__ = true`

관련 파일:

- `src/plugin/log.ts`
- `src/ui/log.ts`

## 12. 권장 코드 읽기 순서

1. `src/ui/index.html`
2. `src/ui/main.ts`
3. `src/ui/state.ts`
4. `src/ui/steps.ts`
5. `src/ui/style-tab.ts`
6. `src/plugin/main.ts`
7. `src/plugin/init.ts`
8. `src/plugin/data-layer.ts`
9. `src/plugin/style.ts`
10. `src/plugin/drawing/*`

