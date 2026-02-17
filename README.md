# Dynamic Chart Figma Plugin

Figma 차트 컴포넌트(`bar`, `line`, `stackedBar`)를 데이터 기반으로 생성/수정하고,  
UI에서 Data Preview + Export Preview(D3 코드 포함)를 제공하는 플러그인입니다.

실제 소스는 `bro/` 하위에 있습니다.

## 1. 핵심 기능

- 차트 인스턴스 생성(`generate`) / 기존 인스턴스 업데이트(`apply`)
- 선택된 차트의 저장값 복원(`init`)
- 스타일 추출(`extract_style`) 및 UI 동기화(`style_extracted`)
- Data Preview / Export Preview 모두 D3 기반 렌더링
- Grid <-> Preview 양방향 하이라이트
  - Grid hover -> Mark highlight
  - Mark hover -> Grid highlight
  - Cell hover -> 정확히 1개 mark highlight
- Auto-resize 감지 후 마지막 설정으로 자동 재적용

## 2. 최신 반영 사항

### 2.1 보조선(`Asst_line_지표종류`) 기능

- 신규 대상 컴포넌트:
  - 컨테이너: `Asst_line_min`, `Asst_line_max`, `Asst_line_avg` (패턴 탐색)
  - 텍스트 프로퍼티: `Asst_line_data`
- 동작:
  - 값(`min/max/avg`)은 매 Apply + Auto-resize 때 재계산
  - Y축 스케일(`yMin~yMax`) 기준으로 `paddingTop` 계산
  - 체크된 지표만 표시/주입
- UI:
  - `보조선` 라벨 + `ON/OFF` 마스터 토글
  - 라벨 클릭 시 팝오버(`min/max/avg` 체크박스)
  - 바깥 영역 클릭 시 닫힘(선택값 유지)

관련 코드:
- `bro/src/plugin/drawing/assist-line.ts`
- `bro/src/ui/index.html`
- `bro/src/ui/main.ts`

### 2.2 Save/Edit 모드 정책

- 모드: `read` / `edit`
- `read`:
  - Graph/Data 입력 잠금
  - Grid readOnly
  - Apply 활성 가능(유효 데이터일 때)
- `edit`:
  - Graph/Data 입력 가능
  - Apply 비활성

관련 코드:
- `bro/src/ui/mode.ts`
- `bro/src/ui/grid.ts`

### 2.3 Raw yMax 동작

- Raw 모드에서 `yMax`는 자동 보정
- 기본: 데이터 최대값
- 사용자 입력이 최대값보다 작으면 최대값으로 보정

관련 코드:
- `bro/src/ui/y-range.ts`
- `bro/src/ui/mode.ts`
- `bro/src/ui/steps.ts`

### 2.4 Bar width / Mark ratio

- `Column Width Ratio(markRatio)`는 저장/복원됨
- bar cluster는 `gap=0` 규칙으로 동작
- `markNum > 1`일 때 cluster를 균등 분할해 preview/Figma 렌더 동기화

관련 코드:
- `bro/src/plugin/drawing/bar.ts`
- `bro/src/ui/preview.ts`
- `bro/src/ui/export.ts`

### 2.5 Column 탐색 구조 확장

- 기존: `Graph -> col-N`
- 추가 지원: `Graph -> col(container) -> col-N`

관련 코드:
- `bro/src/plugin/drawing/shared.ts`

## 3. 아키텍처

- Plugin Runtime(Figma): `bro/src/plugin/*`
- UI Runtime(iframe): `bro/src/ui/*`
- Shared types: `bro/src/shared/*`

Entry:
- Plugin: `bro/src/plugin/main.ts`
- UI: `bro/src/ui/main.ts`

## 4. 메시지 계약

UI -> Plugin
- `generate`
- `apply`
- `extract_style`
- `resize`

Plugin -> UI
- `init`
- `style_extracted`

주요 필드:
- `chartType`, `savedValues`, `savedMarkNum`, `lastCellCount`
- `lastMode`, `lastYMin`, `lastYMax`
- `markRatio`, `strokeWidth`
- `assistLineVisible`, `assistLineEnabled`
- `colStrokeStyle`, `cellStrokeStyles`, `rowStrokeStyles`

## 5. 데이터 저장 키

`bro/src/plugin/constants.ts` -> `PLUGIN_DATA_KEYS`

- `CHART_TYPE`
- `LAST_VALUES`, `LAST_DRAWING_VALUES`
- `LAST_MODE`, `LAST_Y_MIN`, `LAST_Y_MAX`
- `LAST_CELL_COUNT`, `LAST_MARK_NUM`
- `LAST_STROKE_WIDTH`
- `LAST_BAR_PADDING`
- `LAST_CORNER_RADIUS`
- `LAST_ASSIST_LINE_VISIBLE`
- `LAST_ASSIST_LINE_ENABLED`

저장/복원:
- 저장: `bro/src/plugin/data-layer.ts::saveChartData`
- 복원: `bro/src/plugin/init.ts`, `bro/src/plugin/data-layer.ts`

## 6. Preview 규칙

Data Preview: `bro/src/ui/preview.ts`  
Export Preview: `bro/src/ui/export.ts`

- x 라벨: `C1..Cn`
- y 라벨: `cellCount + 1`
- bar: markRatio 기반 폭 반영
- line: Data/Export 동일 x 정렬 규칙
- row/col stroke 추출값을 guide + mark stroke에 반영

## 7. 디버그 로그

Figma 콘솔:

- 선택/타겟 인식
  - `[chart-plugin][selection]`
  - `[chart-plugin][selection-resolve]`
- 자동 리사이즈
  - `[chart-plugin][auto-resize]`
- bar ratio/resize
  - `[chart-plugin][bar-ratio-check][summary]`
  - `[chart-plugin][bar-ratio-check][col]`
  - `[chart-plugin][bar-resize][summary]`
  - `[chart-plugin][bar-resize][col]`
- assist line
  - `[chart-plugin][assist-line]`

## 8. 빌드

`bro/`에서 실행:

```bash
npm install
npm run build
```

산출물:
- `bro/dist/index.html`
- `bro/dist/code.js`

## 9. 디렉토리 빠른 맵

- `bro/src/plugin/main.ts`: 메시지 처리, selection sync, apply/generate
- `bro/src/plugin/init.ts`: init payload 생성, auto-resize 재적용
- `bro/src/plugin/style.ts`: 색상/스타일 추출
- `bro/src/plugin/drawing/*.ts`: 차트별 Figma 렌더
- `bro/src/plugin/drawing/assist-line.ts`: 보조선 계산/주입
- `bro/src/plugin/data-layer.ts`: lastValue 저장/복원
- `bro/src/ui/main.ts`: UI bootstrap + 메시지 수신 + 토글 상호작용
- `bro/src/ui/steps.ts`: submit payload 생성
- `bro/src/ui/grid.ts`: 데이터 그리드 렌더/입력
- `bro/src/ui/mode.ts`: 모드/CTA/잠금
- `bro/src/ui/preview.ts`: Data Preview
- `bro/src/ui/export.ts`: Export Preview + 코드 출력
