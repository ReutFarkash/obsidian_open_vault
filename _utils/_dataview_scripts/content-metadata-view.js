// _utils/_dataview_scripts/content-metadata-view.js

// ... (Standard Setup) ...
if (typeof dv === "undefined") return;
if (!dv.current || !dv.current() || !dv.current().file) {
    dv.paragraph("⚠️ Dataview current file context not ready.");
    return;
}

// ===== CONFIG =====
let SUBJECT = dv.current().file.name;
let EXCLUDE_FOLDERS = ["_utils"];
let EXCLUDE_CURRENT_FILE = false;
let AUTO_COLUMNS = false;
let CUSTOM_COLUMNS = [];
let LIMIT = 100;
let SHOW_PAGES = true;
let SHOW_LISTS = true;
let DEBUG_MODE = false;

if (typeof input !== "undefined") {
    if (Array.isArray(input)) CUSTOM_COLUMNS = input;
    else if (typeof input === "object" && input !== null) {
        if (input.subject) SUBJECT = input.subject;
        if (input.columns && Array.isArray(input.columns)) CUSTOM_COLUMNS = input.columns;
        if (input.exclude_folders !== undefined) EXCLUDE_FOLDERS = Array.isArray(input.exclude_folders) ? input.exclude_folders : [input.exclude_folders];
        if (input.exclude_current !== undefined) EXCLUDE_CURRENT_FILE = !!input.exclude_current;
        if (input.auto_columns !== undefined) AUTO_COLUMNS = !!input.auto_columns;
        if (input.limit !== undefined) LIMIT = input.limit;
        if (input.show_pages !== undefined) SHOW_PAGES = !!input.show_pages;
        if (input.show_lists !== undefined) SHOW_LISTS = !!input.show_lists;
        if (input.debug !== undefined) DEBUG_MODE = !!input.debug;
    }
}

// ... (Helpers remain same) ...
const HIDE_KEYS = ["stuffff"];
const METADATA_EXCLUDE_KEYS = ["symbol", "link", "text", "outlinks", "tags", "section", "children", "task", "checked", "annotated", "header", "path", "line", "lineCount", "position", "list", "subtasks", "real", "image", "parent", "file"];
const isLink = (value) => value?.constructor?.name === "Link";
const normalizeToID = (value) => {
    let path = "";
    if (isLink(value)) path = value.path;
    else {
        let raw = String(value);
        if (raw.startsWith("[[") && raw.endsWith("]]")) raw = raw.slice(2, -2).split("|")[0];
        path = raw;
    }
    return path.replace(/\.md$/i, "").trim().toLowerCase();
};
const formatValue = (value) => {
    const raw = String(value);
    if (raw === "true") return "✅";
    if (raw === "false") return "❌";
    if (raw.startsWith("http")) return `[Link](${raw})`;
    if (/^\[.*\]\(.*\)$/.test(raw)) return raw;
    const path = isLink(value) ? value.path : raw.replace(/^[[|\]]$/g, "").split("|")[0];
    const page = dv.page(path);
    if (page?.file?.tags?.length > 0) {
        const tagString = Array.from(page.file.tags).join(" ");
        return `${value} <span style="font-size: 0.8em; opacity: 0.7;">${tagString}</span>`;
    }
    return value;
};
const cleanContent = (text) => {
    const lines = (text || "").split("\n");
    let result = [];
    for (let line of lines) {
        line = line.trim();
        if (/^\s*(\w|-)+\s*::/.test(line) || line.startsWith("%%")) continue;
        line = line.replace(/\[[\w-]+::\s*\[\[([^\]]+)\]\]\]/g, '');
        line = line.replace(/\([\w-]+::\s*\[\[([^\]]+)\]\]\)/g, '');
        line = line.replace(/\[[\w-]+::\s*[^\]]*\[[^\]]+\]\([^)]+\)[^\]]*\]/g, '');
        line = line.replace(/\[[\w-]+::[^\]]*\]/g, '');
        line = line.replace(/\([\w-]+::[\w\d]+\)/g, '');
        line = line.replace(/\b[\w-]+::\s*[^\s\[]+/g, '');
        if (line) result.push(line);
    }
    return result.join(" ") || "";
};
const collectMetadata = (item, isPage = false) => {
    const metadata = {};
    const excludeKeys = [...METADATA_EXCLUDE_KEYS, ...HIDE_KEYS].map((k) => k.toLowerCase());

    for (const [key, value] of Object.entries(item)) {
        const lowerKey = key.toLowerCase();
        if (!excludeKeys.includes(lowerKey) && value !== undefined && value !== null && value !== "") {
            // For pages, only collect frontmatter/page-level metadata
            if (isPage && item.file) {
                // Only include if it's in frontmatter or is a file.* property
                if (item.file.frontmatter && item.file.frontmatter[key]) {
                    const values = Array.isArray(value) ? dv.array(value) : [value];
                    metadata[key] = new Set(values.map((v) => String(v).trim()).filter(Boolean));
                }
            } else {
                // For list items, collect normally
                const values = Array.isArray(value) ? dv.array(value) : [value];
                metadata[key] = new Set(values.map((v) => String(v).trim()).filter(Boolean));
            }
        }
    }

    Object.entries(metadata).forEach(([key, values]) => { if (values.size === 0) delete metadata[key]; });
    return metadata;
};


const matchesSubjectTag = (tags, subject) => {
    if (!tags || tags.length === 0) return false;
    const searchTag = subject.toLowerCase();
    return tags.some(t => {
        const tag = t.toLowerCase();
        return tag === searchTag || tag.startsWith(searchTag + "/");
    });
};

// <--- FIX: Helper to get Frontmatter Tags Only --->
const getPageTags = (page) => {
    if (!page || !page.file) return [];

    // REMOVED: if (page.file.etags) return page.file.etags;
    // REASON: etags includes inline tags from list items!

    // Strict Frontmatter Check
    if (page.file.frontmatter && page.file.frontmatter.tags) {
        let fmTags = page.file.frontmatter.tags;

        // Handle single string tag (e.g., tags: theory)
        if (typeof fmTags === 'string') {
            return ["#" + fmTags.replace(/^#/, "")];
        }

        // Handle list of tags (e.g., tags: [theory, dev])
        if (Array.isArray(fmTags)) {
            return fmTags.map(t => "#" + t.replace(/^#/, ""));
        }
    }
    return [];
};



// 1. Check List Items (UPDATED)
const isItemVisible = (listItem, subject, sourcePage) => {
    const rawSubject = String(subject).trim();
    if (rawSubject.startsWith("#")) {
        // A. Explicit Item Tag
        if (listItem.tags && matchesSubjectTag(listItem.tags, rawSubject)) return true;

        // B. Implicit Page Tag (Strict Frontmatter Only)
        // If the FILE has the tag in frontmatter, we assume all lists belong to it.
        const pageTags = getPageTags(sourcePage);
        if (pageTags && matchesSubjectTag(pageTags, rawSubject)) return true;

        return false;
    }
    // Link Mode
    const subjectID = normalizeToID(rawSubject);
    if (listItem.outlinks?.some((link) => normalizeToID(link) === subjectID)) return true;
    return normalizeToID(listItem.text).includes(subjectID);
};

// 2. Check Pages (UPDATED)
const isPageVisible = (page, subject) => {
    const rawSubject = String(subject).trim();
    if (rawSubject.startsWith("#")) {
        // Tag Mode: Page MUST have the tag in FRONTMATTER
        return matchesSubjectTag(getPageTags(page), rawSubject);
    }
    // Link Mode: Page MUST link to the subject
    const subjectID = normalizeToID(rawSubject);
    return page.file.outlinks.some(l => normalizeToID(l) === subjectID);
};

const getFilteredInternalLinks = (listItem, metadata, subject) => {
    if (!listItem.outlinks) return [];
    const subjectID = normalizeToID(subject);
    const excludeIDs = new Set([subjectID]);
    Object.values(metadata).forEach((values) => values.forEach((value) => excludeIDs.add(normalizeToID(value))));
    return listItem.outlinks.filter((link) => !excludeIDs.has(normalizeToID(link)));
};
const buildRelatedColumn = (internalLinks, metadata) => {
    const sections = [];
    if (internalLinks.length > 0) sections.push(internalLinks.map(formatValue).join("<br>"));
    Object.entries(metadata)
        .filter(([, values]) => values.size > 0)
        .sort(([a]) => a)
        .forEach(([key, values]) => {
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            sections.push(`**${label}**: ${Array.from(values).map(formatValue).join(", ")}`);
        });
    return sections.join("<br>");
};

// ===== MAIN EXECUTION =====
let sourceParts = [];
const rawSubject = String(SUBJECT).trim();
if (rawSubject.startsWith("#")) sourceParts.push(rawSubject);
else sourceParts.push('""');
EXCLUDE_FOLDERS.forEach(folder => sourceParts.push(`-"${folder.replace(/"/g, '\\"')}"`));
if (EXCLUDE_CURRENT_FILE) sourceParts.push(`-"${dv.current().file.path.replace(/"/g, '\\"')}"`);
const sourceQuery = sourceParts.join(" AND ");

const allItems = [];
const allKeys = new Set();
const pages = dv.pages(sourceQuery);

pages.forEach(page => {
    const sortKey = page.file.mtime || page.file.ctime;

    // A. Collect List Items
    if (SHOW_LISTS && page.file.lists) {
        page.file.lists.forEach((listItem) => {
            if (!isItemVisible(listItem, SUBJECT, page)) return;
            const metadata = collectMetadata(listItem, false); // false = not a page
            if (AUTO_COLUMNS) Object.keys(metadata).forEach(k => allKeys.add(k));
            allItems.push({ type: "list", item: listItem, metadata: metadata, sortKey: sortKey });
        });
    }

    // B. Collect Page
    if (SHOW_PAGES && isPageVisible(page, SUBJECT)) {
        const metadata = collectMetadata(page, true); // true = is a page
        if (AUTO_COLUMNS) Object.keys(metadata).forEach(k => allKeys.add(k));
        allItems.push({ type: "page", item: page, metadata: metadata, sortKey: sortKey });
    }

});

let displayColumns = AUTO_COLUMNS ? Array.from(allKeys).sort((a, b) => a.localeCompare(b)) : CUSTOM_COLUMNS;

const rows = allItems
    .sort((a, b) => (b.sortKey < a.sortKey ? -1 : 1))
    .slice(0, LIMIT)
    .map(({ type, item, metadata }) => {
        let content, whereColumn, internalLinks;
        if (type === "list") {
            content = cleanContent(item.text);
            whereColumn = item.link;
            internalLinks = getFilteredInternalLinks(item, metadata, SUBJECT);
        } else {
            content = `📄 **${item.file.link}**`;
            whereColumn = item.file.folder;
            internalLinks = item.file.outlinks.filter(l => normalizeToID(l) !== normalizeToID(SUBJECT));
        }
        const columnValues = displayColumns.map(colKey => {
            const foundKey = Object.keys(metadata).find(k => k.toLowerCase() === colKey.toLowerCase());
            if (foundKey && metadata[foundKey]) {
                const val = Array.from(metadata[foundKey]).map(formatValue).join(", ");
                delete metadata[foundKey];
                return val;
            }
            return "";
        });
        const relatedColumn = buildRelatedColumn(internalLinks, metadata);
        return [content, ...columnValues, relatedColumn, whereColumn];
    });

const colHeaders = displayColumns.map(c => c.charAt(0).toUpperCase() + c.slice(1));
const tableHeaders = ["Content", ...colHeaders, "Links & Metadata", "Where"];

if (!rows.length) {
    dv.paragraph(`⚠️ No items found for: **${SUBJECT}**`);
} else {
    if (allItems.length > LIMIT) dv.paragraph(`<small>Showing ${LIMIT} of ${allItems.length} items.</small>`);
    dv.table(tableHeaders, rows);
}
