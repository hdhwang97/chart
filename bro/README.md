# Dynamic Chart v1.0.0

Figma에서 `bar`, `line`, `stackedBar` 차트를 생성하고 수정하는 플러그인입니다.  
현재 릴리스 기준 이름은 `Dynamic Chart 1.0`이며, UI 런타임(`src/ui`)과 Plugin 런타임(`src/plugin`)이 `postMessage`로 통신합니다.

## Version

- Plugin name: `Dynamic Chart 1.0`
- Package version: `1.0.0`
- Scope: 현재 저장소의 UI/Plugin 코드 기준 `v1.0` 정리

## What v1.0 Includes

### Data Tab

- 데이터 그리드 편집
- 행/열 추가 및 구조 변경
- `raw` / `percent` 모드 전환
- Y 범위(`Y Min`, `Y Max`) 설정
- Preview 헤더의 `소수점 표시` ON/OFF 토글
- Preview 헤더의 `guide line` ON/OFF 토글 및 min/max/avg/ctr 제어
- CSV import / export

### Style Tab

- `Templates` 섹션
  - 템플릿 저장, 적용, 이름 변경, 삭제
  - 차트 썸네일과 요약 색상 표시
- `Style Injection` 섹션
  - `Mark` / `Plot Area` 탭
  - `Plot Area` 내 `Background`, `X-axis line`, `Y-axis line`, `Border`, `guide line` 카드
  - 카드의 `Visible`이 꺼지면 카드 내용은 disabled + `opacity: 50%`
  - `Visible` 체크박스는 disabled 상태에서도 항상 클릭 가능
- Preview 헤더의 `guide line` 토글과 Style Injection의 `guide line` visible 상태 동기화

### Export Tab

- Export 전용 preview 렌더
- 현재 데이터/스타일 기준 코드 생성 흐름
- Export preview 축 텍스트 폰트를 Data / Style preview와 동일하게 적용

## Supported Chart Types

- `bar`
- `line`
- `stackedBar`

## Development

```bash
npm install
npm run build
npm run lint
```

빌드 결과:

- `npm run build:ui` -> `dist/index.html`
- `npm run build:code` -> `dist/code.js`

## Project Structure

```text
bro/
├─ manifest.json
├─ package.json
├─ dist/
├─ src/
│  ├─ plugin/
│  │  ├─ main.ts
│  │  ├─ init.ts
│  │  ├─ data-layer.ts
│  │  ├─ style.ts
│  │  ├─ template-store.ts
│  │  └─ drawing/
│  │     ├─ bar.ts
│  │     ├─ line.ts
│  │     ├─ stacked.ts
│  │     ├─ assist-line.ts
│  │     └─ stroke-injection.ts
│  ├─ ui/
│  │  ├─ index.html
│  │  ├─ style.css
│  │  ├─ main.ts
│  │  ├─ state.ts
│  │  ├─ dom.ts
│  │  ├─ preview.ts
│  │  ├─ grid.ts
│  │  ├─ style-tab.ts
│  │  ├─ style-popover.ts
│  │  ├─ style-templates.ts
│  │  ├─ export.ts
│  │  ├─ csv.ts
│  │  ├─ data-ops.ts
│  │  ├─ mode.ts
│  │  └─ steps.ts
│  └─ shared/
│     └─ style-types.ts
```

## Key Runtime Responsibilities

### UI (`src/ui`)

- 탭 전환, 입력 상태 관리, preview 렌더
- Data / Style / Export 탭 이벤트 처리
- 스타일 템플릿 UI와 paint style UI 처리
- Plugin으로 `generate`, `apply`, `extract_style`, 템플릿/스타일 관련 메시지 전송

### Plugin (`src/plugin`)

- 현재 선택 노드 해석
- 차트 생성 및 기존 차트 apply
- pluginData / local override 저장 및 복원
- 스타일 추출
- 스타일 템플릿 저장소 처리

## Message Types

### UI -> Plugin

- `generate`
- `apply`
- `extract_style`
- `resize`
- `list_paint_styles`
- `create_paint_style`
- `rename_paint_style`
- `update_paint_style_color`
- `load_style_templates`
- `save_style_template`
- `rename_style_template`
- `delete_style_template`

### Plugin -> UI

- `init`
- `style_extracted`
- `paint_styles_loaded`
- `paint_style_created`
- `paint_style_renamed`
- `paint_style_updated`
- `paint_style_error`
- `style_templates_loaded`
- `style_template_saved`
- `style_template_renamed`
- `style_template_deleted`
- `style_template_error`

## Styling Data Model Notes

- `assistLineVisible`와 `assistLineEnabled`는 preview guide line 표시 상태를 담당
- `styleInjectionDraft.assistLine`은 guide line의 색상, 두께, stroke style을 담당
- mark stroke side 옵션은 내부 state로 유지되지만, 현재 `Style Injection > Mark` 카드 UI에서는 숨김 상태

## External Domains

- `https://cdn.jsdelivr.net`
- `https://cdn.tailwindcss.com`
- `https://d3js.org`

## Current Naming

- UI에서는 기존 `Assist Line` / `보조선` 대신 `guide line` 표기를 사용
- `Plot Area` 탭 내부의 중복 카드명은 `Border`로 정리
