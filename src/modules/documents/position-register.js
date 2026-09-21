// Documentary consistency only. No inference about a position's physical state.
export const POSITION_CATEGORIES = ['Піхотні', 'Мін. Батр.', 'Вогневі', 'БпЛА', 'Інші', 'Запасні позиції'];
export const POSITION_ACTIONS = ['виставлена', 'облаштовується', 'знята', 'знищена', 'переміщена', 'перейменована'];
const norm = text => String(text || '').normalize('NFKC').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
const closed = status => ['знята', 'знищена'].includes(status);

export function buildPositionRegister(rows, throughDate = '9999-12-31') {
    const entries = new Map(), links = new Map(), issues = new Map(), ambiguousNames = new Set();
    const byEntryDate = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.date <= throughDate)
        .sort((a, b) => a.row.date.localeCompare(b.row.date) || (a.row.createdAt || '').localeCompare(b.row.createdAt || '') || a.index - b.index);
    // Entry time is not event time. A later-entered creation document can be
    // explicitly linked before another event on the same day, without falsifying dates.
    const creations = new Map(), preparationStarts = new Map(), ordered = [], emitted = new Set();
    for (const item of byEntryDate) if (item.row.status === 'виставлена') {
        const id = item.row.positionId || item.row.id;
        creations.set(id, creations.has(id) ? null : item);
    }
    for (const item of byEntryDate) if (item.row.status === 'облаштовується' && item.row.opensRegister) {
        const id = item.row.positionId || item.row.id;
        preparationStarts.set(id, preparationStarts.has(id) ? null : item);
    }
    const batchPrerequisites = new Map(), preparedBatches = new Set();
    for (const item of byEntryDate) if (item.row.renameBatchId) {
        if (!batchPrerequisites.has(item.row.renameBatchId)) batchPrerequisites.set(item.row.renameBatchId, new Set());
        const creation = creations.get(item.row.positionId);
        if (creation && creation.row.date === item.row.date) batchPrerequisites.get(item.row.renameBatchId).add(creation);
    }
    for (const item of byEntryDate) {
        const creation = item.row.opensRegister ? null : item.row.status === 'виставлена' ? preparationStarts.get(item.row.positionId || item.row.id) : item.row.positionId && creations.get(item.row.positionId);
        const prerequisites = item.row.renameBatchId && !preparedBatches.has(item.row.renameBatchId) ? [...batchPrerequisites.get(item.row.renameBatchId)] : [creation];
        if (item.row.renameBatchId) preparedBatches.add(item.row.renameBatchId);
        for (const dependency of prerequisites) if (dependency && dependency.row.date === item.row.date && !emitted.has(dependency)) {
            const preparation = dependency.row.status === 'виставлена' && preparationStarts.get(dependency.row.positionId || dependency.row.id);
            if (preparation && preparation.row.date === item.row.date && !emitted.has(preparation)) { ordered.push(preparation); emitted.add(preparation); }
            ordered.push(dependency); emitted.add(dependency);
        }
        if (!emitted.has(item)) { ordered.push(item); emitted.add(item); }
    }
    const activeNamed = name => [...entries.values()].filter(entry => !closed(entry.status) && norm(entry.name) === norm(name));
    const append = (entry, row) => {
        if (!entry.records.some(item => item.id === row.id)) entry.records.push(row);
        links.set(row.id, entry.id);
    };
    const open = (row, id, established, creationId = '') => {
        const entry = { id, name: row.name, category: row.category || '', status: row.status, date: row.date, creationId, established, aliases: [row.name], records: [], latest: row };
        entries.set(id, entry); append(entry, row); ambiguousNames.delete(norm(row.name));
        return entry;
    };
    const rename = (entry, row) => {
        entry.name = row.newName;
        if (!entry.aliases.includes(row.newName)) entry.aliases.push(row.newName);
    };
    const renameError = (row, id, currentName) => {
        if (row.status !== 'перейменована' && !norm(row.newName)) return '';
        if (!norm(row.newName)) return 'Для перейменування не зазначено нову назву.';
        if (norm(row.newName) === norm(currentName)) return 'Нова назва збігається з поточною назвою в реєстрі.';
        if (activeNamed(row.newName).some(other => other.id !== id)) return 'Нова назва вже належить іншому незакритому запису реєстру.';
        return '';
    };
    const finish = (entry, row) => {
        if (norm(row.newName)) rename(entry, row);
        entry.status = row.status; entry.date = row.date; entry.latest = row;
        if (row.category) entry.category = row.category;
    };
    const batches = new Map(), processedBatches = new Set();
    for (const { row } of ordered) if (row.renameBatchId) {
        if (!batches.has(row.renameBatchId)) batches.set(row.renameBatchId, []);
        batches.get(row.renameBatchId).push(row);
    }
    for (const { row } of ordered) {
        const problem = message => issues.set(row.id, message);
        if (!POSITION_ACTIONS.includes(row.status)) { problem('Невідома документальна дія. Перевірте старий запис.'); continue; }
        if (row.renameBatchId) {
            if (processedBatches.has(row.renameBatchId)) continue;
            processedBatches.add(row.renameBatchId);
            const batch = batches.get(row.renameBatchId), sourceIds = new Set(batch.map(item => item.positionId)), targets = batch.map(item => norm(item.newName));
            let error = '';
            if (batch.some(item => item.status !== 'перейменована' || item.date !== row.date)) error = 'Пакет перейменування має містити лише перейменування з однією датою.';
            else if (sourceIds.size !== batch.length || new Set(targets).size !== batch.length || targets.some(name => !name)) error = 'У пакеті повторюється позиція або нова назва.';
            else if (batch.some(item => !entries.get(item.positionId)?.established || closed(entries.get(item.positionId)?.status))) error = 'У пакеті є позиція без попереднього незакритого виставлення.';
            else if (batch.some(item => norm(entries.get(item.positionId).name) === norm(item.newName))) error = 'У пакеті нова назва збігається з попередньою.';
            else if (batch.some(item => activeNamed(item.newName).some(other => !sourceIds.has(other.id)))) error = 'Нова назва з пакета належить іншому незакритому запису.';
            if (error) { batch.forEach(item => issues.set(item.id, error)); continue; }
            // Simultaneous documentary renames: A→B and B→A are one operation.
            for (const item of batch) { const entry = entries.get(item.positionId); append(entry, item); finish(entry, item); }
            continue;
        }
        if (row.status === 'виставлена') {
            const id = row.positionId || row.id;
            const prepared = entries.get(id);
            if (prepared && (prepared.established || closed(prepared.status))) { problem('Повторне виставлення в одному ланцюжку. Для нового виставлення створіть окремий запис реєстру.'); continue; }
            if (activeNamed(row.name).some(entry => entry.id !== id)) { ambiguousNames.add(norm(row.name)); problem('У реєстрі вже є незакритий запис із такою назвою. Якщо це облаштування, виберіть його для продовження історії.'); continue; }
            const error = renameError(row, id, prepared?.name || row.name);
            if (error) { problem(error); continue; }
            if (prepared) {
                if (norm(prepared.name) !== norm(row.name)) { problem('Назва виставлення не збігається з пов’язаним облаштуванням. Перевірте зв’язок.'); continue; }
                prepared.established = true; prepared.creationId = row.id; append(prepared, row); finish(prepared, row);
            } else finish(open(row, id, true, row.id), row);
            continue;
        }
        if (row.status === 'облаштовується' && row.opensRegister) {
            const id = row.positionId || row.id;
            const earlier = entries.get(id);
            const error = renameError(row, id, earlier?.name || row.name);
            if (error) { problem(error); continue; }
            if (earlier?.forwardRootId === row.id && !earlier.established && !closed(earlier.status)) {
                delete earlier.forwardRootId; append(earlier, row); finish(earlier, row); continue;
            }
            if (entries.has(id) || activeNamed(row.name).length) { problem('Для цього облаштування вже є незакритий запис. Виберіть його, а не створюйте нову історію.'); continue; }
            finish(open(row, id, false), row);
            continue;
        }
        // Only explicitly linked construction documents may precede deployment.
        // Legacy orphan rows are not silently promoted into new registry entries.
        if (row.status === 'облаштовується' && row.positionId && !entries.has(row.positionId)) {
            const future = preparationStarts.get(row.positionId)?.row || creations.get(row.positionId)?.row;
            const error = renameError(row, row.positionId, row.name);
            if (error) { problem(error); continue; }
            if (future && future.date >= row.date && !activeNamed(row.name).length) open(row, row.positionId, false).forwardRootId = future.id;
        }
        const matches = row.positionId ? [entries.get(row.positionId)].filter(Boolean) : ambiguousNames.has(norm(row.name)) ? [] : activeNamed(row.name);
        if (matches.length !== 1) { problem('Немає однозначного попереднього запису виставлення. Виберіть зв’язок із реєстром або додайте відсутній документ.'); continue; }
        const entry = matches[0];
        append(entry, row);
        if (closed(entry.status)) { problem('Перед цією дією в документах уже зафіксовано зняття або знищення.'); continue; }
        if (!entry.established && !['облаштовується', 'знята', 'знищена'].includes(row.status)) { problem('Є лише документ облаштування. Для цієї дії спочатку потрібен документ виставлення.'); continue; }
        if (row.status === 'переміщена' && row.destinationPositionId) {
            if (row.destinationPositionId === entry.id) { problem('Не можна посилатися на цю саму позицію як на інше місце.'); continue; }
            if (!entries.has(row.destinationPositionId)) { problem('На дату документа немає запису про позицію, на місце якої зазначене переміщення.'); continue; }
        }
        const error = renameError(row, entry.id, entry.name);
        if (error) { problem(error); continue; }
        finish(entry, row);
    }
    return { entries: [...entries.values()], links, issues };
}

export function positionChangeError(before, after, changedId) {
    return positionBatchError(before, after, [changedId]);
}

export function positionBatchError(before, after, changedIds) {
    const previous = buildPositionRegister(before), next = buildPositionRegister(after);
    const changedSet = new Set(changedIds);
    for (const changedId of changedSet) {
        const original = before.find(row => row.id === changedId), changed = after.find(row => row.id === changedId);
        // Allow missing document numbers/PBD/notes to be corrected in legacy orphan rows.
        const metadataOnly = original && changed && ['name', 'date', 'status', 'newName', 'positionId', 'opensRegister', 'destinationPositionId', 'destinationName', 'renameBatchId'].every(key => (original[key] || '') === (changed[key] || ''));
        if (changed && next.issues.has(changedId) && !metadataOnly) return next.issues.get(changedId);
    }
    for (const [id, message] of next.issues) {
        if (previous.issues.get(id) !== message && !changedSet.has(id)) return 'Зміна порушить історію наступного запису: ' + message;
    }
    for (const [id, link] of previous.links) {
        if (!changedSet.has(id) && next.links.has(id) && next.links.get(id) !== link) return 'Зміна переприв’яже інший документ до іншого виставлення. Спершу явно звірте зв’язки записів.';
    }
    return '';
}

export function eligiblePositions(rows, draft) {
    const preceding = rows.filter(row => row.id !== draft.id && (row.date < draft.date || (row.date === draft.date && (row.status === 'виставлена' || !draft.createdAt || (row.createdAt || '') <= draft.createdAt))));
    return buildPositionRegister(preceding, draft.date).entries.filter(entry => !closed(entry.status) && (draft.status === 'облаштовується' || draft.status === 'виставлена' ? true : entry.established));
}

export function preparationChoices(rows, draft) {
    const choices = eligiblePositions(rows, { ...draft, status: 'облаштовується' });
    const ids = new Set(choices.map(entry => entry.id));
    // A clerk can enter an earlier construction document after the later
    // deployment document has already been recorded. This does not change dates.
    for (const entry of buildPositionRegister(rows.filter(row => row.id !== draft.id)).entries) {
        const creation = entry.records.find(row => row.id === entry.creationId) || entry.records.find(row => row.opensRegister);
        if (creation && creation.date > draft.date && !ids.has(entry.id)) {
            choices.push({ ...entry, name: creation.name, category: creation.category || entry.category, futureDocument: true }); ids.add(entry.id);
        }
    }
    return choices;
}

export function documentaryNameCatalog(rows) {
    const registry = buildPositionRegister(rows);
    const known = new Set(rows.flatMap(row => [row.name, row.newName]).filter(Boolean));
    const names = registry.entries.filter(entry => !closed(entry.status) && !entry.records.some(row => registry.issues.has(row.id))).map(entry => entry.name);
    return { names: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'uk')), known };
}

export function withPositionAudit(previous, next, now = new Date().toISOString()) {
    const oldRows = new Map(previous.positions.map(row => [row.id, row]));
    const newRows = new Map(next.positions.map(row => [row.id, row]));
    const beforeRegister = buildPositionRegister(previous.positions), afterRegister = buildPositionRegister(next.positions);
    const changes = [];
    for (const id of new Set([...oldRows.keys(), ...newRows.keys()])) {
        const before = oldRows.get(id), after = newRows.get(id);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        changes.push({ id: crypto.randomUUID(), recordId: id, positionId: afterRegister.links.get(id) || beforeRegister.links.get(id) || after?.positionId || before?.positionId || '', at: now, before: before || null, after: after || null });
    }
    return changes.length ? { ...next, positionAudit: [...(previous.positionAudit || []), ...changes] } : next;
}
