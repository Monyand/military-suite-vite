import fs from 'fs';
import path from 'path';

const rankMap = {
    'солдат': 'Солдат',
    'старший солдат': 'Ст. солдат',
    'молодший сержант': 'Мл. сержант',
    'сержант': 'Сержант',
    'старший сержант': 'Ст. сержант',
    'головний сержант': 'Головний сержант',
    'штаб-сержант': 'Штаб-сержант',
    'майстер-сержант': 'Майстер-сержант',
    'молодший лейтенант': 'Мл. лейтенант',
    'лейтенант': 'Лейтенант',
    'старший лейтенант': 'Ст. лейтенант',
    'капітан': 'Капітан',
    'майор': 'Майор',
    'підполковник': 'Підполковник',
    'полковник': 'Полковник',
    'рядовий': 'Солдат',
    'матрос': 'Солдат',
    'рекрут': 'Солдат',
    'молодший лейтенант медичної служби': 'Мл. лейтенант'
};

const fullRankMap = {
    'солдат': 'Солдат',
    'старший солдат': 'Старший солдат',
    'молодший сержант': 'Молодший сержант',
    'сержант': 'Сержант',
    'старший сержант': 'Старший сержант',
    'головний сержант': 'Головний сержант',
    'штаб-сержант': 'Штаб-сержант',
    'майстер-сержант': 'Майстер-сержант',
    'молодший лейтенант': 'Молодший лейтенант',
    'лейтенант': 'Лейтенант',
    'старший лейтенант': 'Старший лейтенант',
    'капітан': 'Капітан',
    'майор': 'Майор',
    'підполковник': 'Підполковник',
    'полковник': 'Полковник',
    'рядовий': 'Рядовий',
    'матрос': 'Матрос',
    'рекрут': 'Рекрут',
    'молодший лейтенант медичної служби': 'Молодший лейтенант медичної служби'
};

function normalizeRank(rawRank) {
    if (!rawRank) return 'Солдат';
    const clean = rawRank.toLowerCase().trim();
    return fullRankMap[clean] || rankMap[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
}

function normalizeDisplayRank(rawRank) {
    if (!rawRank) return 'Солдат';
    const clean = rawRank.toLowerCase().trim();
    return rankMap[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
}

function parseHtmlFile(filePath) {
    const fileName = path.basename(filePath);
    const defaultUnitName = fileName.replace(/\.html$/i, '').trim();
    const content = fs.readFileSync(filePath, 'utf8');

    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

    let pibIdx = 1;
    let unitIdx = 2;
    let rankIdx = 5;
    let posIdx = 6;
    let callsignIdx = 20;
    let headerFound = false;

    let section = 'ШТАТ';
    const soldiers = [];
    let match;

    while ((match = trRegex.exec(content)) !== null) {
        const rowHtml = match[1];
        const cells = [];
        let cellMatch;
        while ((cellMatch = tdRegex.exec(rowHtml)) !== null) {
            let text = cellMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
            text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
            cells.push(text);
        }
        if (!cells.length) continue;

        const rowText = cells.join(' ');
        if (rowText.includes('ВІДРИВ ПОЗА ШТАТОМ')) {
            section = 'ВІДРИВ ПОЗА ШТАТОМ';
            continue;
        } else if (rowText.includes('ПОЗА ШТАТОМ')) {
            section = 'ПОЗА ШТАТОМ';
            continue;
        } else if (rowText.includes('ВІДРИВ')) {
            section = 'ВІДРИВ';
            continue;
        } else if (rowText.includes('ШТАТ') && cells.length < 5) {
            section = 'ШТАТ';
            continue;
        }

        if (!headerFound) {
            const foundPib = cells.findIndex(c => c.toLowerCase().includes('п.і.б') || c.toLowerCase() === 'піб');
            if (foundPib !== -1) {
                headerFound = true;
                pibIdx = foundPib;
                const foundCallsign = cells.findIndex(c => c.toLowerCase().includes('позивний'));
                if (foundCallsign !== -1) callsignIdx = foundCallsign;
                const foundRank = cells.findIndex(c => c.toLowerCase().includes('звання'));
                if (foundRank !== -1) rankIdx = foundRank;
                const foundPos = cells.findIndex(c => c.toLowerCase().includes('посада'));
                if (foundPos !== -1) posIdx = foundPos;
                const foundUnit = cells.findIndex(c => c.toLowerCase().includes('підрозділ'));
                if (foundUnit !== -1) unitIdx = foundUnit;
                continue;
            }
        }

        // Check if row starts with a sequence number
        if (cells.length > Math.max(pibIdx, rankIdx) && /^\d+$/.test(cells[0])) {
            const rawName = cells[pibIdx] || '';
            if (!rawName || rawName.toLowerCase().includes('п.і.б') || rawName.toLowerCase() === 'піб') continue;

            const actualUnit = cells[unitIdx] || defaultUnitName;
            const rank = cells[rankIdx] || 'солдат';
            const position = cells[posIdx] || 'стрілець';
            const callsign = (callsignIdx !== -1 && cells[callsignIdx]) ? cells[callsignIdx] : '';

            let note = '';
            if (section !== 'ШТАТ') {
                note = `[${section}]`;
            }

            soldiers.push({
                fullName: rawName.trim(),
                callsign: callsign.trim(),
                rank: normalizeDisplayRank(rank),
                fullRank: normalizeRank(rank),
                role: position.trim() || 'Стрілець',
                unit: (actualUnit.trim() || defaultUnitName),
                section,
                notes: note,
                sourceFile: fileName
            });
        }
    }

    return soldiers;
}

export function runBatchParse() {
    const searchDirs = ['.', './html_inputs'];
    const ignoredFiles = new Set(['index.html', 'MilitarySuite.html', 'vkladki_chrome.html', 'мої_вкладки.html', 'ПБД звіти.html']);
    
    const targetFiles = new Set();
    for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue;
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            if (entry.endsWith('.html') && !ignoredFiles.has(entry) && !entry.startsWith('test')) {
                targetFiles.add(path.resolve(dir, entry));
            }
        }
    }

    if (targetFiles.size === 0) {
        console.log('No personnel HTML files found to parse in . or ./html_inputs');
        return;
    }

    console.log(`Found ${targetFiles.size} HTML files to process:`);
    targetFiles.forEach(f => console.log(` - ${path.basename(f)}`));

    const allSoldiers = [];
    const unitCounts = {};

    for (const filePath of targetFiles) {
        const fileSoldiers = parseHtmlFile(filePath);
        console.log(`Processed ${path.basename(filePath)}: extracted ${fileSoldiers.length} personnel`);
        for (const s of fileSoldiers) {
            allSoldiers.push(s);
            unitCounts[s.unit] = (unitCounts[s.unit] || 0) + 1;
        }
    }

    console.log(`\nTotal personnel extracted across all files: ${allSoldiers.length}`);
    console.log('Units summary:');
    Object.entries(unitCounts).forEach(([u, count]) => {
        console.log(` - ${u}: ${count} soldiers`);
    });

    // Write TSV matching modal: ПІБ \t Підрозділ \t Звання \t Позивний
    const tsvHeader = ['ПІБ', 'Підрозділ', 'Звання', 'Позивний'].join('\t');
    const tsvRows = allSoldiers.map(s => [
        s.fullName,
        s.unit,
        s.rank,
        s.callsign
    ].join('\t'));

    const tsvContent = [tsvHeader, ...tsvRows].join('\n');
    fs.writeFileSync('import_all_personnel.tsv', tsvContent, 'utf8');
    fs.writeFileSync('import_all_personnel.json', JSON.stringify(allSoldiers, null, 2), 'utf8');

    console.log(`\nSuccessfully generated:`);
    console.log(` - import_all_personnel.tsv (${allSoldiers.length} records)`);
    console.log(` - import_all_personnel.json`);
}

// Run directly if executed
if (process.argv[1] && process.argv[1].endsWith('parse-personnel-html.mjs')) {
    runBatchParse();
}
