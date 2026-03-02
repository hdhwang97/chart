# Dynamic Chart Figma Plugin (`bro`)

Figma 차트 컴포넌트(`bar`, `line`, `stackedBar`)를 데이터/스타일 기반으로 생성·수정하는 플러그인입니다.  
구성은 UI 런타임(`src/ui`) + Plugin 런타임(`src/plugin`)이며 `postMessage`로 통신합니다.

## 1) 빠른 실행

```bash
npm install
npm run build
npm run lint
```

- `npm run build:ui` -> `dist/index.html`
- `npm run build:code` -> `dist/code.js`

---

## 2) 상세 프로젝트 구조 (트리 + 역할)

```text
bro/
├─ manifest.json                         # Figma 플러그인 메타(이름/엔트리/allowedDomains)
├─ package.json                          # build/lint 스크립트, 의존성
├─ package-lock.json                     # npm lock 파일
├─ tsconfig.json                         # TypeScript 설정
├─ vite.config.ui.ts                     # UI 번들 설정(dist/index.html)
├─ vite.config.code.ts                   # Plugin 번들 설정(dist/code.js)
├─ vite.config.ts                        # 레거시/보조 설정
├─ vite.config.js                        # 레거시/보조 설정
├─ config.ts                             # 레거시/보조 설정
├─ config.js                             # 레거시/보조 설정
├─ dist/
│  ├─ index.html                         # 빌드된 UI
│  └─ code.js                            # 빌드된 Plugin 코드
└─ src/
   ├─ plugin/
   │  ├─ main.ts                         # 메시지 라우팅, selectionchange, apply/generate
   │  ├─ init.ts                         # init payload 구성, 컴포넌트 탐색/구조 추론
   │  ├─ data-layer.ts                   # pluginData + local override 저장/복원
   │  ├─ constants.ts                    # 패턴/키/상수 정의
   │  ├─ style.ts                        # 현재 차트 스타일 추출
   │  ├─ utils.ts                        # 색상/노드/스타일링 유틸
   │  ├─ template-store.ts               # 스타일 템플릿 저장소
   │  ├─ perf.ts                         # 성능 측정 로그 유틸
   │  └─ drawing/
   │     ├─ shared.ts                    # 차트 공통 접근/유틸
   │     ├─ y-range.ts                   # Y 범위 계산(raw/percent)
   │     ├─ bar.ts                       # Bar 적용 로직
   │     ├─ stacked.ts                   # Stacked Bar 적용 로직
   │     ├─ line.ts                      # Line 적용 로직
   │     ├─ assist-line.ts               # min/max/avg/ctr 보조선
   │     └─ stroke-injection.ts          # fill/stroke 인젝션 동기화
   ├─ ui/
   │  ├─ index.html                      # UI 마크업 엔트리
   │  ├─ style.css                       # UI 스타일
   │  ├─ main.ts                         # UI 이벤트 + plugin 메시지 처리
   │  ├─ state.ts                        # 전역 상태
   │  ├─ dom.ts                          # DOM accessor
   │  ├─ steps.ts                        # generate/apply payload 생성
   │  ├─ style-tab.ts                    # 스타일 탭 로직
   │  ├─ grid.ts                         # 데이터 그리드 렌더/편집
   │  ├─ preview.ts                      # 프리뷰 렌더
   │  ├─ mode.ts                         # raw/percent 유효성
   │  ├─ y-range.ts                      # UI Y 범위 계산
   │  ├─ data-ops.ts                     # row/col/group 조작
   │  ├─ csv.ts                          # CSV import/export
   │  ├─ export.ts                       # Export 탭 로직
   │  ├─ components/
   │  │  └─ graph-setting-tooltip.ts     # 그래프 설정 툴팁 컴포넌트
   │  └─ assets/
   │     └─ tooltips/
   │        ├─ cell-count.svg            # Cell Count 툴팁 이미지
   │        ├─ column-width-ratio.svg    # Column Width Ratio 툴팁 이미지
   │        ├─ graph-col.svg             # Graph Col 툴팁 이미지
   │        ├─ mark-count.svg            # Mark Count 툴팁 이미지
   │        ├─ segments.svg              # Segments 툴팁 이미지
   │        ├─ thickness.svg             # Thickness 툴팁 이미지
   │        ├─ y-max.svg                 # Y Max 툴팁 이미지
   │        └─ y-min.svg                 # Y Min 툴팁 이미지
   ├─ shared/
   │  └─ style-types.ts                  # UI/Plugin 공유 타입
   └─ logic/
      └─ .DS_Store                       # macOS 시스템 파일(무시 대상)
```

---

## 3) 메시지 계약 요약

### UI -> Plugin

- `generate` # 새 인스턴스 생성 후 데이터/스타일 적용
- `apply` # 선택된 차트 대상 업데이트
- `extract_style` # 현재 선택 대상 스타일 추출
- `resize` # UI 사이즈 변경
- `list_paint_styles` # 로컬 PaintStyle 조회
- `create_paint_style` # PaintStyle 생성
- `rename_paint_style` # PaintStyle 이름 변경
- `update_paint_style_color` # PaintStyle 색상 업데이트
- `load_style_templates` # 스타일 템플릿 목록
- `save_style_template` # 스타일 템플릿 저장
- `rename_style_template` # 스타일 템플릿 이름 변경
- `delete_style_template` # 스타일 템플릿 삭제

### Plugin -> UI

- `init` # selection 기준 편집 초기값 전달
- `style_extracted` # 추출된 스타일 payload 전달
- `paint_styles_loaded` # PaintStyle 목록 전달
- `paint_style_created` # PaintStyle 생성 결과
- `paint_style_renamed` # PaintStyle 이름 변경 결과
- `paint_style_updated` # PaintStyle 색상 변경 결과
- `paint_style_error` # PaintStyle 관련 에러
- `style_templates_loaded` # 스타일 템플릿 목록 전달
- `style_template_saved` # 템플릿 저장 결과
- `style_template_renamed` # 템플릿 이름 변경 결과
- `style_template_deleted` # 템플릿 삭제 결과
- `style_template_error` # 템플릿 처리 에러

---

## 4) A/B/C/D 구조별 동작표

정의:

- A 타입 # 원본 Chart 컴포넌트(parent)
- B 타입 # A의 instance(child)
- C 타입 # B를 감싼 master component(child)
- D 타입 # C의 instance(grand child)

| 구분 | 노드 타입(일반) | 선택 시 타겟 해석 | 데이터 저장(pluginData) | 로컬 오버라이드 | 스타일/컬러 적용 우선순위 | 비고 |
|---|---|---|---|---|---|---|
| A | `COMPONENT` | A 자체 또는 하위 chart 인식 시 A | 저장 가능 | 없음 | pluginData 기반 | 구조 기준점 |
| B | `INSTANCE` | B 자체 우선 | 저장 가능 | 가능 | local override > pluginData > 추출값 | 인스턴스 독립 커스터마이즈 |
| C | `COMPONENT` | C 선택 시 하위 chart(B 계열) resolve | C/resolve 대상 기준 저장 | 없음(컴포넌트 자체) | pluginData/추출값 | `isCType` 조건 시 resize 보정 실행 |
| D | `INSTANCE` | D 선택 시 하위/내부 chart resolve | 저장 가능 | 가능 | local override > pluginData > 추출값 | C에서 설정한 내용이 기본값으로 전달될 수 있음 |

### C 타입 추가 동작(현재 구현)

- C 타입 판별 조건 # `selectedNode.type === COMPONENT` + resolve된 chart target이 C 하위 `INSTANCE`
- 판별 후 resize 보정 # 지정 레이어만 수정
  - C root -> `FIXED/FIXED`
  - first child -> `FILL/FILL`
  - `chart` -> `FILL/FILL`
  - `chart_main` -> `FILL/FILL` (하위 유지)
  - `chart_legend`(또는 `chart_legned`) -> width `FILL`

---

## 5) 색상/스타일 정책 요약

- `ColorMode` # `hex` 또는 `paint_style`
- row/col 별 상태 # `rowColorModes`, `rowPaintStyleIds`, `colColorModes`, `colPaintStyleIds`
- Bar/Stacked # paint style 사용 시 fill + stroke 동시 주입
- Line # vector는 stroke만 style link 적용, 실패 시 hex fallback
- Save(Paint style mode) # 선택 PaintStyle 색상 갱신 + 현재 대상 즉시 반영

---

## 6) 현재 운영 메모

- manifest 이름: `Test 1.0.2`
- allowedDomains:
  - `https://cdn.jsdelivr.net`
  - `https://cdn.tailwindcss.com`
  - `https://d3js.org`
