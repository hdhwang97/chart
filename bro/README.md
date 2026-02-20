# Dynamic Chart Figma Plugin (bro)

이 문서는 **AI/개발자가 코드베이스를 빠르게 파악하고 수정 지점을 정확히 찾기 위한 구조 중심 가이드**입니다.

## 1. 플러그인 한 줄 설명
- Figma 인스턴스형 차트 컴포넌트(`bar`, `line`, `stackedBar`)에 대해
- UI에서 데이터/스타일을 입력하고
- Plugin 코드가 레이어/variant/pluginData를 갱신하여 차트를 생성/수정합니다.

## 2. 런타임 아키텍처

### 2.1 프로세스 분리
- `src/ui/*`: 브라우저 런타임(플러그인 UI 패널)
- `src/plugin/*`: Figma Plugin API 런타임(문서 노드 수정)

### 2.2 통신 방향
- UI -> Plugin
  - `generate`: 새 차트 인스턴스 생성 후 적용
  - `apply`: 선택된 차트 인스턴스 업데이트
  - `extract_style`: 현재 선택 차트 스타일 추출
  - `resize`: UI 크기 변경
- Plugin -> UI
  - `init`: 선택 노드 기준 UI 초기 데이터 전달
  - `style_extracted`: 추출된 스타일/컬러/선 스타일 전달

### 2.3 핵심 이벤트 흐름
1. 플러그인 시작 시 `figma.showUI(__html__)` 호출 (`src/plugin/main.ts`).
2. 선택 변경(`selectionchange`) 시 차트 노드 인식 -> `initPluginUI()`로 UI 동기화.
3. UI에서 `submitData()` 호출 시 payload 전송 (`src/ui/steps.ts`).
4. Plugin에서 차트 타입별 드로잉 함수 실행:
   - bar: `applyBar()`
   - line: `applyLine()`
   - stacked: `applyStackedBar()`
   - assist line: `applyAssistLines()`
5. 적용 후 `saveChartData()`로 pluginData 저장, `style_extracted` 재전송.
6. Auto-resize loop가 선택 노드 크기 변화를 감지하면 자동 재적용.

## 3. 디렉터리 구조

```text
.
├─ manifest.json                # Figma manifest (main/ui entry, allowedDomains)
├─ package.json                 # build/lint 스크립트
├─ vite.config.ui.ts            # UI 번들 설정 (single file + figma script compat)
├─ vite.config.code.ts          # plugin code 번들 설정
├─ src
│  ├─ plugin
│  │  ├─ main.ts                # plugin entry, 메시지 핸들러, selection/auto-resize
│  │  ├─ init.ts                # 컴포넌트 탐색/가져오기, UI 초기화, 구조 추론
│  │  ├─ data-layer.ts          # pluginData 저장/로드
│  │  ├─ style.ts               # Figma 노드 스타일 추출(색/두께/스트로크)
│  │  ├─ constants.ts           # variant 키, pluginData 키, 레이어 패턴 정규식
│  │  ├─ utils.ts               # 공통 유틸(트래버스, 색상 변환, fill/stroke 적용)
│  │  └─ drawing
│  │     ├─ shared.ts           # 컬럼 수집, visibility, Y축 라벨 공통 처리
│  │     ├─ bar.ts              # Bar 렌더링
│  │     ├─ line.ts             # Line 렌더링
│  │     ├─ stacked.ts          # Stacked Bar 렌더링
│  │     ├─ assist-line.ts      # 최소/최대/평균 보조선 렌더링
│  │     └─ y-range.ts          # 실제 Y 범위 계산(raw/percent)
│  ├─ ui
│  │  ├─ main.ts                # UI entry, 이벤트 바인딩, 메시지 처리
│  │  ├─ index.html             # UI 마크업, CDN(tailwind/d3/iro)
│  │  ├─ style.css              # UI 스타일
│  │  ├─ state.ts               # 전역 상태 및 색상 유틸
│  │  ├─ dom.ts                 # DOM accessor
│  │  ├─ grid.ts                # 데이터 그리드 렌더
│  │  ├─ preview.ts             # 미리보기 렌더
│  │  ├─ mode.ts                # raw/percent 모드 및 유효성
│  │  ├─ data-ops.ts            # 행/열/그룹 구조 편집
│  │  ├─ steps.ts               # 단계 전환, submit payload 생성
│  │  ├─ export.ts              # Export 탭, D3 preview/code 생성
│  │  ├─ csv.ts                 # CSV 업로드/파싱/다운로드
│  │  └─ y-range.ts             # UI 기준 Y 범위 계산
│  └─ shared
│     └─ style-types.ts         # UI/Plugin 공용 스타일 타입
└─ dist                         # 빌드 산출물(code.js, index.html)
```

## 4. 파일별 책임 (빠른 참조)

### 4.1 Plugin 영역
- `src/plugin/main.ts`
  - 메시지 라우팅의 중심.
  - 차트 대상 노드 해석(`resolveChartTargetFromSelection`)과 차트 인식.
  - 타입별 렌더 함수 호출, 스타일 추출, 저장, UI 응답.
- `src/plugin/init.ts`
  - 마스터 컴포넌트 탐색/가져오기(`getOrImportComponent`).
  - 선택 노드에서 UI 초기값 로딩(`initPluginUI`).
  - 기존 레이어 구조를 데이터로 역추론(`inferStructureFromGraph`).
- `src/plugin/data-layer.ts`
  - pluginData 스키마에 맞춰 저장/복원.
  - 저장값이 없으면 구조 추론 fallback.
- `src/plugin/style.ts`
  - 색상, 선 두께, 셀/행 스트로크 스타일 등 추출.
- `src/plugin/drawing/*`
  - 차트 실제 도형/가시성/variant 조작 담당.

### 4.2 UI 영역
- `src/ui/main.ts`
  - UI 초기화와 전체 이벤트 wiring.
  - Plugin 메시지(`init`, `style_extracted`) 수신 후 상태 동기화.
- `src/ui/steps.ts`
  - 생성/수정 submit payload 생성의 단일 진입점(`submitData`).
- `src/ui/state.ts`
  - 데이터/모드/행열/색상 상태 소스 오브 트루스.
- `src/ui/export.ts`
  - Export 탭 렌더 및 D3 코드 문자열 생성.
- `src/ui/mode.ts`, `src/ui/y-range.ts`
  - Y축 관련 유효성/자동 최대값 처리.

## 5. PluginData 저장 키
정의 위치: `src/plugin/constants.ts` -> `PLUGIN_DATA_KEYS`

핵심 키:
- `chartType`
- `lastAppliedValues` (UI 원본)
- `lastDrawingValues` (렌더링용)
- `lastAppliedMode`
- `lastCellCount`
- `lastMarkNum`
- `lastYMin`, `lastYMax`
- `lastBarPadding`
- `lastRowColors`
- `lastCornerRadius`
- `lastStrokeWidth`
- `lastAssistLineEnabled`, `lastAssistLineVisible`

## 6. 레이어/컴포넌트 의존 규칙
정의 위치: `src/plugin/constants.ts` -> `MARK_NAME_PATTERNS`

플러그인은 Figma 내부 레이어 이름 패턴을 전제로 동작합니다. 대표 예시:
- 컬럼: `col-1`, `col-2`...
- 셀: `cel1`, `cel2`... (정규식 매칭)
- 라인: `line-1`...
- 보조선: 이름에 `asst_line` + `min/max/avg` 포함
- Y축 컨테이너: `y-axis`

이 규칙이 깨지면 추론/적용 일부가 실패할 수 있습니다.

## 7. 빌드/실행

### 7.1 스크립트
- `npm run build:ui` -> `dist/index.html`
- `npm run build:code` -> `dist/code.js`
- `npm run build` -> UI + code 순차 빌드
- `npm run lint`

### 7.2 번들 특이사항
- UI는 `vite-plugin-singlefile`로 단일 HTML 번들 (`vite.config.ui.ts`).
- Figma UI sandbox 호환을 위해 `type="module"` 제거 후처리.
- Plugin code는 IIFE(`code.js`)로 출력 (`vite.config.code.ts`).

## 8. 수정 시 우선 진입점
- 차트 적용 로직 수정: `src/plugin/main.ts`, `src/plugin/drawing/*`
- 초기값/선택 동기화 문제: `src/plugin/init.ts`
- 저장 데이터 스키마 변경: `src/plugin/constants.ts`, `src/plugin/data-layer.ts`
- UI 입력/검증/전송 변경: `src/ui/steps.ts`, `src/ui/mode.ts`, `src/ui/main.ts`
- Export 코드 생성 변경: `src/ui/export.ts`

## 9. 참고 메모
- `config.ts`, `config.js`, `vite.config.ts`, `vite.config.js`는 현재 주 실행 경로(`src/plugin/main.ts`, `src/ui/index.html`) 기준으로는 사용되지 않는 레거시/보조 설정 파일일 수 있으니, 수정 전 참조 여부를 먼저 확인하세요.
