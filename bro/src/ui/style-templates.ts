import { buildLocalStyleOverridesFromDraft, SavedStylePayload, buildDraftFromPayload } from './style-normalization';
import { ui } from './dom';
import { ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, getGridColsForChart, getRowColor, getTotalStackedCols, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, setLocalStyleOverrideField, state } from './state';
import { emitStyleDraftUpdated, hydrateStyleTab, markStyleInjectionDirty, setStyleInjectionDraft } from './style-tab';

import type { StyleTemplateItem, StyleTemplatePayload } from '../shared/style-types';



const MAX_STYLE_TEMPLATES = 20;

export function formatTemplateTime(ts: number): string {
    try {
        return new Date(ts).toLocaleDateString();
    } catch {
        return '-';
    }
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function toSavedStylePayload(payload: StyleTemplatePayload): SavedStylePayload {
    return {
        savedCellFillStyle: payload.cellFillStyle,
        savedLineBackgroundStyle: payload.lineBackgroundStyle,
        savedMarkStyle: payload.markStyle,
        savedMarkStyles: payload.markStyles,
        savedRowColors: payload.rowColors,
        savedCellTopStyle: payload.cellTopStyle,
        savedTabRightStyle: payload.tabRightStyle,
        savedGridContainerStyle: payload.gridContainerStyle,
        savedAssistLineStyle: payload.assistLineStyle
    };
}

export function normalizeTemplateNameInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return null;
    return trimmed;
}

export function closeTemplateNameEditor() {
    state.editingTemplateId = null;
    state.editingTemplateName = '';
}

export function estimateNextTemplateName(): string {
    const names = new Set(state.styleTemplates.map((item) => item.name));
    for (let i = 1; i <= MAX_STYLE_TEMPLATES + 1; i++) {
        const candidate = `Template ${i}`;
        if (!names.has(candidate)) return candidate;
    }
    return `Template ${Date.now()}`;
}

export function applyTemplateToDraft(template: StyleTemplateItem): boolean {
    const nextDraft = buildDraftFromPayload(toSavedStylePayload(template.payload), {});
    setStyleInjectionDraft(nextDraft);
    hydrateStyleTab(nextDraft);
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    if (Array.isArray(template.payload.colColors)) {
        state.colHeaderColors = template.payload.colColors
            .map((color) => normalizeHexColorInput(color) || getRowColor(0))
            .slice(0, totalCols);
        ensureColHeaderColorsLength(totalCols);
    }
    if (Array.isArray(template.payload.colColorEnabled)) {
        state.colHeaderColorEnabled = template.payload.colColorEnabled
            .map((flag) => Boolean(flag))
            .slice(0, totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
    }
    if (Array.isArray(template.payload.colColorModes)) {
        state.colHeaderColorModes = template.payload.colColorModes
            .map((value) => value === 'paint_style' ? 'paint_style' : 'hex')
            .slice(0, totalCols);
        ensureColHeaderColorModesLength(totalCols);
    }
    if (Array.isArray(template.payload.colPaintStyleIds)) {
        state.colHeaderPaintStyleIds = template.payload.colPaintStyleIds
            .map((value) => (typeof value === 'string' && value.trim()) ? value : null)
            .slice(0, totalCols);
        ensureColHeaderPaintStyleIdsLength(totalCols);
    }
    if (state.isInstanceTarget) {
        const draftOverrides = buildLocalStyleOverridesFromDraft(nextDraft);
        setLocalStyleOverrideField('rowColors', draftOverrides.overrides.rowColors);
        setLocalStyleOverrideField('cellFillStyle', draftOverrides.overrides.cellFillStyle);
        setLocalStyleOverrideField('cellTopStyle', draftOverrides.overrides.cellTopStyle);
        setLocalStyleOverrideField('tabRightStyle', draftOverrides.overrides.tabRightStyle);
        setLocalStyleOverrideField('gridContainerStyle', draftOverrides.overrides.gridContainerStyle);
        setLocalStyleOverrideField('assistLineStyle', draftOverrides.overrides.assistLineStyle);
        setLocalStyleOverrideField('markStyle', draftOverrides.overrides.markStyle);
        setLocalStyleOverrideField('markStyles', draftOverrides.overrides.markStyles);
        setLocalStyleOverrideField('rowStrokeStyles', draftOverrides.overrides.rowStrokeStyles);
        setLocalStyleOverrideField('colStrokeStyle', draftOverrides.overrides.colStrokeStyle);
        setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorModes', ensureColHeaderColorModesLength(totalCols).slice());
        setLocalStyleOverrideField('colPaintStyleIds', ensureColHeaderPaintStyleIdsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
    markStyleInjectionDirty();
    state.selectedStyleTemplateId = template.id;
    emitStyleDraftUpdated();
    renderStyleTemplateGallery();
    return true;
}

export function renderTemplateCard(item: StyleTemplateItem): string {
    const selectedClass = state.selectedStyleTemplateId === item.id ? ' selected' : '';
    const inEdit = state.styleTemplateMode === 'edit';
    const editing = inEdit && state.editingTemplateId === item.id;
    const swatches = [
        item.payload.cellFillStyle?.color || '#FFFFFF',
        item.payload.markStyle?.lineBackgroundColor || item.payload.markStyle?.strokeColor || item.payload.markStyle?.fillColor || '#3B82F6',
        item.payload.markStyle?.fillColor || item.payload.markStyle?.strokeColor || '#3B82F6',
        item.payload.cellTopStyle?.color || '#E5E7EB',
        item.payload.tabRightStyle?.color || '#E5E7EB',
        item.payload.gridContainerStyle?.color || '#E5E7EB',
        item.payload.assistLineStyle?.color || '#E5E7EB'
    ];
    const escapedName = escapeHtml(item.name);

    return `
<div class="style-template-card${selectedClass}" data-template-id="${item.id}">
  <div class="style-template-preview">
    ${swatches.map((color) => `<span class="style-template-swatch" style="background:${escapeHtml(color || '#E5E7EB')}"></span>`).join('')}
  </div>
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      ${editing
            ? `<input class="w-full px-1.5 py-0.5 border border-border rounded text-xxs" data-template-rename-input-id="${item.id}" value="${escapeHtml(state.editingTemplateName || item.name)}" maxlength="40" />`
            : `<div class="text-xxs font-semibold text-text truncate">${escapedName}</div>`
        }
      <div class="text-[10px] text-text-sub">Updated ${formatTemplateTime(item.updatedAt)}</div>
    </div>
    ${inEdit
            ? editing
                ? `<div class="flex gap-1">
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-primary hover:bg-blue-50 cursor-pointer" data-template-rename-save-id="${item.id}" type="button">Save</button>
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-sub hover:bg-gray-50 cursor-pointer" data-template-rename-cancel-id="${item.id}" type="button">Cancel</button>
                   </div>`
                : `<div class="flex gap-1">
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-sub hover:bg-gray-50 cursor-pointer" data-template-rename-id="${item.id}" type="button">Rename</button>
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-danger hover:bg-red-50 cursor-pointer style-template-delete-btn" data-template-delete-id="${item.id}" type="button">Delete</button>
                   </div>`
            : ''
        }
  </div>
</div>`;
}

export function renderStyleTemplateGallery() {
    const gallery = ui.styleTemplateGallery;
    const readActive = state.styleTemplateMode === 'read';
    ui.styleTemplateModeReadBtn.className = readActive
        ? 'px-2 py-0.5 text-xxs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer'
        : 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer';
    ui.styleTemplateModeEditBtn.className = readActive
        ? 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer'
        : 'px-2 py-0.5 text-xxs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer';
    ui.styleTemplateAddBtn.disabled = state.styleTemplates.length >= MAX_STYLE_TEMPLATES;
    if (ui.styleTemplateAddBtn.disabled) ui.styleTemplateAddBtn.classList.add('read-panel-disabled');
    else ui.styleTemplateAddBtn.classList.remove('read-panel-disabled');

    if (state.styleTemplates.length === 0) {
        gallery.innerHTML = `<div class="style-template-empty">저장된 템플릿이 없습니다.</div>`;
        return;
    }
    gallery.innerHTML = state.styleTemplates.map(renderTemplateCard).join('');
}

export function setStyleTemplateList(items: StyleTemplateItem[]) {
    state.styleTemplates = Array.isArray(items) ? items : [];
    if (state.selectedStyleTemplateId && !state.styleTemplates.some((item) => item.id === state.selectedStyleTemplateId)) {
        state.selectedStyleTemplateId = null;
    }
    if (state.editingTemplateId && !state.styleTemplates.some((item) => item.id === state.editingTemplateId)) {
        closeTemplateNameEditor();
    }
    renderStyleTemplateGallery();
}

export function setStyleTemplateMode(mode: 'read' | 'edit') {
    state.styleTemplateMode = mode;
    if (mode === 'read') closeTemplateNameEditor();
    renderStyleTemplateGallery();
}

export function requestNewTemplateName(): string {
    return estimateNextTemplateName();
}


export function bindStyleTemplateEvents() {
    ui.styleTemplateModeReadBtn.addEventListener('click', () => setStyleTemplateMode('read'));
    ui.styleTemplateModeEditBtn.addEventListener('click', () => setStyleTemplateMode('edit'));

    ui.styleTemplateGallery.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const renameBtn = target.closest<HTMLButtonElement>('[data-template-rename-id]');
        if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = renameBtn.dataset.templateRenameId;
            if (!id) return;
            const template = state.styleTemplates.find((item) => item.id === id);
            if (!template) return;
            state.editingTemplateId = id;
            state.editingTemplateName = template.name;
            renderStyleTemplateGallery();
            return;
        }

        const renameCancelBtn = target.closest<HTMLButtonElement>('[data-template-rename-cancel-id]');
        if (renameCancelBtn) {
            e.preventDefault();
            e.stopPropagation();
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }

        const renameSaveBtn = target.closest<HTMLButtonElement>('[data-template-rename-save-id]');
        if (renameSaveBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = renameSaveBtn.dataset.templateRenameSaveId;
            if (!id) return;
            const input = ui.styleTemplateGallery.querySelector<HTMLInputElement>(`[data-template-rename-input-id="${id}"]`);
            const normalized = normalizeTemplateNameInput(input?.value || state.editingTemplateName);
            if (!normalized) {
                window.alert('템플릿 이름은 1~40자로 입력해야 합니다.');
                return;
            }
            parent.postMessage({ pluginMessage: { type: 'rename_style_template', id, name: normalized } }, '*');
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }

        const deleteBtn = target.closest<HTMLButtonElement>('[data-template-delete-id]');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = deleteBtn.dataset.templateDeleteId;
            if (!id) return;
            if (!window.confirm('이 템플릿을 삭제하시겠습니까?')) return;
            parent.postMessage({ pluginMessage: { type: 'delete_style_template', id } }, '*');
            return;
        }

        const card = target.closest<HTMLElement>('[data-template-id]');
        if (!card) return;
        if (state.styleTemplateMode === 'edit') return;
        const id = card.dataset.templateId;
        if (!id) return;
        const template = state.styleTemplates.find((item) => item.id === id);
        if (!template) return;
        applyTemplateToDraft(template);
    });

    ui.styleTemplateGallery.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const input = target.closest<HTMLInputElement>('[data-template-rename-input-id]');
        if (!input) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const id = input.dataset.templateRenameInputId;
            if (!id) return;
            const normalized = normalizeTemplateNameInput(input.value || state.editingTemplateName);
            if (!normalized) {
                window.alert('템플릿 이름은 1~40자로 입력해야 합니다.');
                return;
            }
            parent.postMessage({ pluginMessage: { type: 'rename_style_template', id, name: normalized } }, '*');
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
        }
    });
}
