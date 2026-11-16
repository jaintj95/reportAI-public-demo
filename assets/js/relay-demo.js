/* Relay demo: the release's own front-end scripts (two patched for static hosting) plus a small controller that stands in for the Gradio runtime. */
/* Relay demo controller.
 *
 * Stands in for Gradio's runtime on a static page. The markup and styles were
 * captured from the real Relay app; every answer is played back from a
 * recording. Nothing here contacts a server: chart and source-preview data,
 * PDF page images and original files ship with the page.
 */
(function relayDemoController() {
    'use strict';
    const D = window.RELAY_DEMO;
    const doc = document;
    const $ = (selector, root = doc) => root.querySelector(selector);
    const $$ = (selector, root = doc) => [...root.querySelectorAll(selector)];
    const KEY = 'relay.demo.chat.v1';
    const store = {
        get() { try { return window.sessionStorage.getItem(KEY); } catch (_) { return null; } },
        set(value) { try { window.sessionStorage.setItem(KEY, value); } catch (_) { /* storage unavailable */ } },
        clear() { try { window.sessionStorage.removeItem(KEY); } catch (_) { /* storage unavailable */ } },
    };
    const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const randomHex = () => {
        const bytes = new Uint8Array(16);
        (window.crypto || {getRandomValues: a => a.map(() => Math.floor(Math.random() * 256))}).getRandomValues(bytes);
        return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const element = html => {
        const template = doc.createElement('template');
        template.innerHTML = html.trim();
        return template.content.firstElementChild;
    };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    /* ---------- Recorded data served to Relay's own scripts ---------- */
    const recordId = token => token.slice(0, 32);
    const jsonResponse = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
        status, headers: {'Content-Type': 'application/json'}}));
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function relayDemoFetch(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const path = url.split('#')[0].split('?')[0];
        let match = /relay\/charts\/([A-Za-z0-9_-]{43})\/data$/.exec(path);
        if (match) {
            const chart = D.charts[recordId(match[1])];
            return chart ? jsonResponse(chart) : jsonResponse({error: 'This chart link has expired or is unavailable. Ask for the report again.'}, 410);
        }
        match = /^(.*relay\/documents\/([A-Za-z0-9_-]{43}))\/data$/.exec(path);
        if (match) {
            const preview = D.previews[recordId(match[2])];
            if (!preview) return jsonResponse({error: 'This source link has expired or is unavailable. Ask the question again to get a new link.'}, 410);
            const base = match[1];
            const data = JSON.parse(JSON.stringify(preview.data));
            data.download = base + '/download';
            if (data.document) {
                data.document.page_url = base + '/page';
                data.original = base + '/original#page=' + data.document.initial_page;
            }
            return jsonResponse(data);
        }
        if (/relay\/(?:session|feedback|activity)/.test(path)) return jsonResponse({}, 404);
        return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error('Network unavailable'));
    };
    const blobs = new Map();
    function fileFor(base) {
        const match = /relay\/documents\/([A-Za-z0-9_-]{43})/.exec(base || '');
        const preview = match && D.previews[recordId(match[1])];
        return preview ? {preview, file: D.files[preview.file]} : {};
    }
    // Used by the patched copy of document-preview.js.
    window.relayDemo = {
        pageImage(pageURL, number) {
            const {preview} = fileFor(pageURL);
            return preview && preview.pages ? preview.pages[number] || null : null;
        },
        links(actions, data, base) {
            const {file} = fileFor(base);
            for (const anchor of [...actions.querySelectorAll('a')]) {
                const original = anchor.textContent === 'Open original PDF at cited page';
                if (!file) { anchor.remove(); continue; }
                if (original) {
                    anchor.href = file.href + '#page=' + (data.document ? data.document.initial_page : 1);
                    continue;
                }
                if (D.mode === 'artifact') {
                    if (file.href && file.mime === 'application/pdf') {
                        anchor.href = file.href;  // the viewer blocks downloads; open the file instead
                    } else {
                        const note = doc.createElement('span');
                        note.className = 'relay-demo-note';
                        note.textContent = 'Download isn’t available in this demo.';
                        anchor.replaceWith(note);
                    }
                    continue;
                }
                if (file.b64) {
                    if (!blobs.has(file.name)) {
                        const raw = atob(file.b64), bytes = new Uint8Array(raw.length);
                        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                        blobs.set(file.name, URL.createObjectURL(new Blob([bytes], {type: file.mime})));
                    }
                    anchor.href = blobs.get(file.name);
                } else {
                    anchor.href = file.href;
                }
                anchor.download = file.name;
                anchor.removeAttribute('target');
            }
        },
    };

    /* ---------- Sign-in, activity and feedback endpoints, kept in this tab ---------- */
    let chat = {v: 1, items: [], conv: null, next: null, feedback: {}};
    const save = () => store.set(JSON.stringify(chat));
    window.relayGetSession = () => Promise.resolve({
        display_name: 'Demo visitor', feedback_categories: D.feedbackCategories, feedback_max_details: 4000});
    window.relayPost = async (path, data) => {
        if (path === '/relay/feedback') {
            await wait(250);
            chat.feedback[data.turn_id] = data.rating;
            save();
            return {ok: true, rating: data.rating, feedback_id: data.feedback_id};
        }
        if (path === '/relay/feedback/status') {
            const result = {};
            for (const id of data.turn_ids || []) if (chat.feedback[id]) result[id] = {rating: chat.feedback[id]};
            return result;
        }
        return {};
    };
    window.relayRecordVisible = () => Promise.resolve();

    /* ---------- Theme (the app opens in light mode; the header button switches it) ---------- */
    window.pmisDark = false;
    const syncTheme = () => {
        if (doc.body.classList.contains('dark') !== window.pmisDark) doc.body.classList.toggle('dark', window.pmisDark);
    };
    syncTheme();
    new MutationObserver(syncTheme).observe(doc.body, {attributes: true, attributeFilter: ['class']});
    const toggleTheme = () => { window.pmisDark = !window.pmisDark; doc.body.classList.toggle('dark', window.pmisDark); };

    /* ---------- Gradio layout pieces: sidebar, accordion, textbox ---------- */
    const sidebar = $('#sidebar');
    const sidebarToggle = sidebar.querySelector('.toggle-button');
    const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const syncMotion = () => sidebar.classList.toggle('reduce-motion', Boolean(motion && motion.matches));
    syncMotion();
    if (motion && motion.addEventListener) motion.addEventListener('change', syncMotion);
    sidebarToggle.addEventListener('click', () => {
        const open = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open', open);
        sidebarToggle.setAttribute('aria-expanded', String(open));
    });
    const overlap = () => {
        const wrap = sidebar.closest('.wrap');
        if (!wrap) return;
        const amount = Math.max(0, sidebar.getBoundingClientRect().width - wrap.getBoundingClientRect().left + 30);
        doc.documentElement.style.setProperty('--overlap-amount', amount + 'px');
    };
    overlap();
    window.addEventListener('resize', overlap);

    const how = $('#how');
    const howButton = how.querySelector('.label-wrap');
    howButton.addEventListener('click', () => {
        const open = !howButton.classList.contains('open');
        howButton.classList.toggle('open', open);
        howButton.querySelector('.icon').style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        how.querySelector('[data-testid="accordion-content"]').style.display = open ? 'block' : 'none';
    });
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $('#mobile-theme-toggle').addEventListener('click', toggleTheme);

    const box = $('#composer textarea');
    const LINES = 1, MAX_LINES = 7;
    function resize() {  // Gradio's textbox: one line that grows to seven as you type
        const style = getComputedStyle(box);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const line = parseFloat(style.lineHeight);
        const most = padding + line * MAX_LINES, least = padding + line * LINES;
        box.style.height = '1px';
        const height = box.scrollHeight > most ? most : box.scrollHeight < least ? least : box.scrollHeight;
        box.style.height = height + 'px';
        box.style.overflowY = box.scrollHeight > box.clientHeight + line ? 'scroll' : 'hidden';
    }
    box.disabled = false;
    box.addEventListener('input', resize);
    const setValue = text => { box.value = text; resize(); };
    const focusComposer = () => {
        if (box.disabled) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
    };
    box.addEventListener('keypress', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    });
    doc.addEventListener('click', event => {
        const target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('#composer .submit-button')) { submit(); return; }
        if (target.closest('#composer .stop-button')) { stop(); return; }
        const example = target.closest('#chat .example');
        if (example) { setValue(example.querySelector('.example-text').textContent.trim()); focusComposer(); return; }
        const option = target.closest('#chat .options .option');
        if (option) { setValue(option.textContent); focusComposer(); return; }
        const sample = target.closest('#sidebar .qitem');
        if (sample) { setValue(sample.textContent.trim()); focusComposer(); return; }
        if (target.closest('#new-chat')) { newChat(); return; }
        const copy = target.closest('#chat button.copy_code_button');
        if (copy) { event.stopImmediatePropagation(); copyCode(copy); return; }
        const title = target.closest('#chat .thought-group > .title');
        if (title) { toggleThought(title.parentElement, true); return; }
        if (target.closest('#chat .scroll-down-button-container button')) toBottom();
    });
    doc.addEventListener('keydown', event => {
        const title = event.target && event.target.closest && event.target.closest('#chat .thought-group > .title');
        if (title && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleThought(title.parentElement, true);
        }
    });

    function copyCode(button) {
        const wrap = button.parentElement;
        const text = wrap.innerText.trim();
        const check = button.children[1];
        const done = () => {
            if (!check) return;
            check.style.opacity = '1';
            setTimeout(() => { check.style.opacity = '0'; }, 2000);
        };
        const select = () => {
            const code = wrap.querySelector('pre') || wrap;
            const range = doc.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        };
        try {
            navigator.clipboard.writeText(text).then(done, select);
        } catch (_) { select(); }
    }

    /* ---------- Chat rendering ---------- */
    const thoughts = new WeakMap();
    const scroller = () => $('#chat .bubble-wrap');
    const atBottom = () => {
        const s = scroller();
        return !s || s.offsetHeight + s.scrollTop > s.scrollHeight - 100;
    };
    function toBottom() {
        const s = scroller();
        if (s) s.scrollTo(0, s.scrollHeight);
        hideScrollDown();
    }
    function hideScrollDown() { const button = $('#chat .scroll-down-button-container'); if (button) button.remove(); }
    function onScroll() {
        if (atBottom()) { hideScrollDown(); return; }
        if (!$('#chat .scroll-down-button-container')) scroller().after(element(D.ui.scrollDown));
    }
    function update(change) {  // Gradio keeps following the chat if the reader was at the bottom
        const following = atBottom();
        change();
        if (following) setTimeout(toBottom, 300);
    }
    function welcome() {
        const wrapper = $('#chat .wrapper');
        if (wrapper && !wrapper.querySelector('.placeholder-content')) wrapper.replaceWith(element(D.ui.chatWelcome));
    }
    function messages() {
        let wrap = $('#chat .message-wrap');
        if (!wrap) {
            $('#chat .wrapper').replaceWith(element(D.ui.chatMessages));
            wrap = $('#chat .message-wrap');
            wrap.append(element(D.ui.optionsEmpty));
            scroller().addEventListener('scroll', onScroll, {passive: true});
        }
        return wrap;
    }
    function setOptions(values) {
        const wrap = messages();
        const fresh = element(D.ui.optionsEmpty);
        for (const value of values || []) {
            const button = element(D.ui.optionButton);
            button.textContent = value;
            fresh.append(button);
        }
        const current = wrap.querySelector(':scope > .options');
        if (current) current.replaceWith(fresh); else wrap.append(fresh);
    }
    function append(htmls) {
        const wrap = messages();
        const anchor = wrap.querySelector(':scope > .options');
        return htmls.map(html => wrap.insertBefore(element(html), anchor));
    }
    function stash(rows, contents) {
        const groups = rows.flatMap(row => $$('.thought-group', row));
        groups.forEach((group, index) => { if (contents[index]) thoughts.set(group, contents[index]); });
    }
    function toggleThought(group, byUser) {
        const title = group.querySelector(':scope > .title');
        const arrow = title.querySelector('.arrow');
        const open = title.classList.contains('expanded');
        if (open) {
            const content = group.querySelector(':scope > .content');
            if (content) { thoughts.set(group, content.outerHTML); content.remove(); }
        } else if (thoughts.has(group)) {
            title.after(element(thoughts.get(group)));
        }
        title.classList.toggle('expanded', !open);
        if (arrow) arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
        if (byUser && run && run.row === group.closest('.message-row')) run.toggled = !open;
    }
    const instance = (html, uid) => html.split('__TURNID__').join(uid)
        .replace(/(relay\/(?:charts|documents)\/[0-9a-f]{32})0{11}/g, (_, path) => path + uid.slice(0, 11));
    const restoredHTML = html => html.split(' relay-chart-auto').join('').split(' relay-preview-auto').join('');
    function userRow(item) {
        const turn = item.id && D.turns[item.id];
        if (turn && (!item.user || item.user === turn.question)) return turn.userRow;
        const text = escapeHTML(item.user || '');
        return D.ui.userRow.split('__USERTEXT__').join(text);
    }
    /* ---------- The configurable reply for questions without a recording (demo-config.js) ---------- */
    const DEFAULTS = {
        name: 'Tejas Jain', firstName: '', linkedinUrl: '', linkedinLabel: 'LinkedIn',
        unmatchedReply: 'Thank you! This question can\'t be answered here because this is a mock version of the real ' +
            'product, built by {name}. If you\'d like to try the production version, reach out to {firstName} on {linkedin}.',
        showSampleQuestions: true,
    };
    function config() {  // a missing file or field falls back to the defaults
        const given = window.RELAY_DEMO_CONFIG && typeof window.RELAY_DEMO_CONFIG === 'object' ? window.RELAY_DEMO_CONFIG : {};
        const text = key => (typeof given[key] === 'string' ? given[key] : DEFAULTS[key]).trim();
        const name = text('name') || DEFAULTS.name;
        return {
            name, firstName: text('firstName') || name.split(/\s+/)[0], linkedinUrl: text('linkedinUrl'),
            linkedinLabel: text('linkedinLabel') || DEFAULTS.linkedinLabel,
            unmatchedReply: typeof given.unmatchedReply === 'string' && given.unmatchedReply.trim() ? given.unmatchedReply : DEFAULTS.unmatchedReply,
            showSampleQuestions: typeof given.showSampleQuestions === 'boolean' ? given.showSampleQuestions : DEFAULTS.showSampleQuestions,
        };
    }
    function safeURL(value) {
        const url = String(value || '').trim();
        if (/^(?:https?:\/\/|mailto:)\S+$/i.test(url)) return url;
        if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(url)) return 'https://' + url;
        return '';  // anything else (empty, javascript:, data:) stays plain text
    }
    const link = (text, href) => '<a href="' + escapeHTML(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(text) + '</a>';
    function replyContent() {
        try { return renderReply(config()); } catch (_) { return renderReply({...DEFAULTS, firstName: DEFAULTS.name.split(' ')[0]}); }
    }
    function renderReply(settings) {
        const url = safeURL(settings.linkedinUrl);
        const values = {name: settings.name, firstName: settings.firstName, linkedin: settings.linkedinLabel};
        const fill = text => text.replace(/\{(name|firstName|linkedin)\}/g, (_, key) => values[key]);
        const token = /\{(name|firstName|linkedin)\}|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
        const paragraphs = settings.unmatchedReply.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean);
        const html = [], plain = [];
        for (const paragraph of paragraphs) {
            let out = '', said = '', last = 0;
            const literal = text => { out += escapeHTML(text).replace(/\n/g, '<br>'); said += text; };
            for (const match of paragraph.matchAll(token)) {
                literal(paragraph.slice(last, match.index));
                if (match[1] === 'linkedin') { out += url ? link(settings.linkedinLabel, url) : escapeHTML(settings.linkedinLabel); said += settings.linkedinLabel; }
                else if (match[1]) { out += escapeHTML(values[match[1]]); said += values[match[1]]; }
                else { const label = fill(match[2]); out += link(label, match[3]); said += label; }
                last = match.index + match[0].length;
            }
            literal(paragraph.slice(last));
            html.push('<p>' + out + '</p>');
            plain.push(said);
        }
        return {html: html.join('\n'), text: plain.join('\n\n'), samples: settings.showSampleQuestions};
    }
    function noticeRow() {
        const content = replyContent();
        return D.ui.noticeRow.split('__NOTICEHTML__').join(content.html).split('__NOTICETEXT__').join(escapeHTML(content.text));
    }
    function samplesFor(item) {  // recorded first questions, the follow-up's own first question first
        if (!replyContent().samples) return [];
        const list = item.first && D.turns[item.first] ? [D.turns[item.first].question] : [];
        for (const id of D.featured) if (!list.includes(D.turns[id].question)) list.push(D.turns[id].question);
        return list;
    }

    const stoppedContent = uid => [D.ui.stoppedContent.split('__TURNID__').join(uid)];
    function rowsFor(item, restored) {
        const turn = item.id && D.turns[item.id];
        if (item.type === 'turn') {
            const rows = [userRow(item), ...turn.botRows].map(html => instance(html, item.uid));
            return restored ? rows.map(restoredHTML) : rows;
        }
        if (item.type === 'notice') return [userRow(item), noticeRow()];
        if (item.type === 'stopped') return [userRow(item), D.ui.stoppedRow.split('__TURNID__').join(item.uid)];
        return [userRow(item), D.ui.interruptedRow];
    }
    function render(item, restored) {
        const elements = append(rowsFor(item, restored));
        if (item.type === 'turn') stash(elements.slice(1), D.turns[item.id].thoughts);
        else if (item.type === 'stopped') stash(elements.slice(1), stoppedContent(item.uid));
        else if (item.type === 'interrupted') stash(elements.slice(1), [D.ui.interruptedContent]);
        return elements;
    }
    const optionsOf = item => item.type === 'turn' ? D.turns[item.id].options : item.type === 'notice' ? samplesFor(item) : [];

    /* ---------- Playback ---------- */
    let run = null;
    const settled = () => setTimeout(() => doc.dispatchEvent(new Event('relay-answer-settled')), 0);
    function setRunning(on) {
        const current = $('#composer .submit-button, #composer .stop-button');
        if (current) current.replaceWith(element(on ? D.ui.stopButton : D.ui.submitButton));
    }
    function begin(item, workingRow) {
        update(() => {
            setOptions([]);
            const [, row] = append([userRow(item), workingRow]);
            run = {item, row, timers: [], toggled: null};
        });
        chat.items.push({...item, type: 'pending', final: item.type});
        save();
        setRunning(true);
    }
    function show(html) {
        if (!run) return;
        update(() => {
            const row = element(instance(html, run.item.uid));
            const group = $('.thought-group', row);
            if (group && run.toggled === false) {  // the reader closed the working step: keep it closed
                const title = group.querySelector(':scope > .title');
                const content = group.querySelector(':scope > .content');
                if (content) { thoughts.set(group, content.outerHTML); content.remove(); }
                title.classList.remove('expanded');
                const arrow = title.querySelector('.arrow');
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
            run.row.replaceWith(row);
            run.row = row;
            const content = $('.thought-group > .content', row);
            if (content) content.scrollTop = content.scrollHeight;
        });
    }
    function finish(item, rows, options) {
        update(() => {
            const elements = rows.map(html => element(html));
            run.row.replaceWith(...elements);
            if (item.type === 'turn') stash(elements, D.turns[item.id].thoughts);
            setOptions(options);
        });
        chat.items[chat.items.length - 1] = item;
        if (item.type === 'turn') { chat.conv = D.turns[item.id].conv; chat.next = D.turns[item.id].next; }
        save();
        run = null;
        setRunning(false);
        if (item.type === 'turn' && chat.next && !box.value.trim()) {
            // The conversation's recorded follow-up waits in the chat box, unsent. Phones keep the
            // keyboard closed; desktops get the caret at its end.
            setValue(D.turns[chat.next].question);
            const pointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
            const compact = window.matchMedia && matchMedia('(max-width: 768px), (max-width: 950px) and (max-height: 500px)').matches;
            if (pointer && !compact) focusComposer();
        }
        settled();
    }
    function playTurn(id, typed) {
        const turn = D.turns[id];
        const item = {type: 'turn', id, uid: randomHex(), user: typed === turn.question ? undefined : typed};
        begin(item, instance(turn.states[0][1], item.uid));
        const timers = run.timers;
        turn.states.slice(1).forEach(([at, html]) => timers.push(setTimeout(() => show(html), at)));
        timers.push(setTimeout(() => finish(item, turn.botRows.map(html => instance(html, item.uid)), turn.options), turn.finalAt));
    }
    function playNotice(typed, first) {
        const item = {type: 'notice', uid: randomHex(), user: typed, ...(first ? {first} : {})};
        begin(item, D.ui.workingRow);
        run.timers.push(setTimeout(() => finish(item, [noticeRow()], samplesFor(item)), 700));
    }
    function stop() {
        if (!run) return;
        run.timers.forEach(clearTimeout);
        const {item} = run;
        const stopped = {type: 'stopped', id: item.id, uid: item.uid, user: item.user};
        update(() => {
            const row = element(D.ui.stoppedRow.split('__TURNID__').join(item.uid));
            run.row.replaceWith(row);
            stash([row], stoppedContent(item.uid));  // opening the step shows its text, as in the release
        });
        chat.items[chat.items.length - 1] = stopped;
        save();
        run = null;
        setRunning(false);
        settled();
    }
    function newChat() {
        const wasRunning = Boolean(run);
        if (run) { run.timers.forEach(clearTimeout); run = null; }
        doc.dispatchEvent(new Event('relay-clear-chat'));
        chat = {v: 1, items: [], conv: null, next: null, feedback: chat.feedback};
        store.clear();
        welcome();
        setRunning(false);
        setValue('');
        if (wasRunning) settled();
    }

    /* ---------- Matching what was asked to a recording ---------- */
    const STOP = new Set(('a an and are as at be by can could do does for from give i in is it its me my of on or ' +
        'please show tell that the these this those to what which with would you your').split(' '));
    const plain = text => String(text).toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();
    const words = text => plain(text).replace(/'s\b/g, '').replace(/[^a-z0-9%$]+/g, ' ').split(' ')
        .filter(word => word && !STOP.has(word)).map(word => word.length > 4 ? word.replace(/s$/, '') : word);
    const same = (a, b) => words(a).join(' ') === words(b).join(' ');
    function overlap2(a, b) {
        const left = new Set(words(a)), right = new Set(words(b));
        if (!left.size || !right.size) return {score: 0, cover: 0};
        let common = 0;
        for (const word of left) if (right.has(word)) common++;
        return {score: common / Math.max(left.size, right.size), cover: common / left.size, common};
    }
    const firsts = () => Object.values(D.conversations).map(ids => ids[0]);
    function choose(text) {
        const all = Object.keys(D.turns);
        if (chat.next && same(text, D.turns[chat.next].question)) return {play: chat.next};
        const exactFirst = all.find(id => D.turns[id].index === 0 && same(text, D.turns[id].question));
        if (exactFirst) return {play: exactFirst};
        if (chat.next) {  // a reworded follow-up within the conversation (e.g. "show that as a bar chart")
            const {score, cover, common} = overlap2(text, D.turns[chat.next].question);
            if (score >= 0.5 || (cover >= 0.75 && common >= 2)) return {play: chat.next};
        }
        const exact = all.find(id => same(text, D.turns[id].question));
        if (exact) return {followUp: exact};  // a recorded follow-up asked out of its conversation
        let best = null;
        for (const id of all) {
            const {score} = overlap2(text, D.turns[id].question);
            if (score >= 0.7 && (!best || score > best.score)) best = {id, score};
        }
        if (best) return D.turns[best.id].index === 0 || best.id === chat.next ? {play: best.id} : {followUp: best.id};
        return {};
    }
    function ask(text) {
        const question = String(text || '').trim();
        if (!question) { settled(); return; }
        const choice = choose(question);
        if (choice.play) { playTurn(choice.play, question); return; }
        // Everything else gets the one configurable reply (demo-config.js).
        playNotice(question, choice.followUp ? D.conversations[D.turns[choice.followUp].conv][0] : null);
    }
    function submit() {
        const text = box.value;
        setValue('');
        ask(text);
    }

    /* ---------- Restore the chat after a reload in the same tab ---------- */
    function restore() {
        let saved = null;
        try { saved = JSON.parse(store.get() || 'null'); } catch (_) { saved = null; }
        if (!saved || saved.v !== 1 || !Array.isArray(saved.items)) return;
        chat = {v: 1, items: [], conv: saved.conv || null, next: saved.next || null, feedback: saved.feedback || {}};
        for (const raw of saved.items) {
            if (!raw || typeof raw !== 'object') continue;
            if (raw.id && !D.turns[raw.id]) continue;
            const item = raw.type === 'pending' ? {type: 'interrupted', id: raw.id, user: raw.user} : raw;
            if (!['turn', 'notice', 'stopped', 'interrupted'].includes(item.type)) continue;
            if (item.type !== 'interrupted' && !/^[0-9a-f]{32}$/.test(item.uid || '')) continue;
            if (item.type === 'notice' && (typeof item.user !== 'string' || (item.first && !D.turns[item.first]))) continue;
            chat.items.push(item);
        }
        if (chat.conv && !D.conversations[chat.conv]) chat.conv = null;
        if (chat.next && !D.turns[chat.next]) chat.next = null;
        if (!chat.items.length) { store.clear(); return; }
        messages();
        for (const item of chat.items) render(item, true);
        setOptions(optionsOf(chat.items[chat.items.length - 1]));
        save();
        toBottom();
        setTimeout(toBottom, 300);
    }

    D.ready = () => {
        restore();
        resize();
        const pointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
        const compact = window.matchMedia && matchMedia('(max-width: 768px), (max-width: 950px) and (max-height: 500px)').matches;
        if (pointer && !compact && (!doc.activeElement || doc.activeElement === doc.body)) box.focus({preventScroll: true});
    };
})();

(function relayDemoStart() {
(() => {
    if (window.relayFeedbackInstalled) return;
    window.relayFeedbackInstalled = true;
    const node = (tag, text, cls) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (cls) element.className = cls;
        return element;
    };
    let dialog, opener, mountTimer;
    const status = node('div', '', 'relay-feedback-toast');
    status.setAttribute('role', 'status');
    document.body.append(status);
    const announce = text => {
        status.textContent = text;
        clearTimeout(window.relayFeedbackToastTimer);
        window.relayFeedbackToastTimer = setTimeout(() => { status.textContent = ''; }, 5000);
    };
    const markSubmitted = (turn, rating) => {
        document.querySelectorAll(`.relay-feedback-row[data-relay-turn="${turn}"]`).forEach(row => {
            row.querySelector('.relay-feedback-saved').textContent = 'Feedback sent';
            row.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rating === rating)));
        });
    };
    const close = () => {
        dialog?.close(); dialog?.remove(); dialog = null;
        opener?.focus({preventScroll: true});
    };
    async function open(button) {
        close(); opener = button;
        const turn = button.closest('.relay-feedback-row').dataset.relayTurn;
        const rating = button.dataset.rating;
        const feedbackId = crypto.randomUUID().replaceAll('-', '');
        dialog = node('dialog', undefined, 'relay-feedback-dialog');
        const current = dialog;
        const header = node('div', undefined, 'relay-feedback-heading');
        const title = node('h2', rating === 'up' ? 'What was helpful?' : 'What could be better?');
        title.id = 'relay-feedback-title'; dialog.setAttribute('aria-labelledby', title.id);
        const exit = node('button', '×', 'relay-feedback-close');
        exit.type = 'button'; exit.setAttribute('aria-label', 'Close feedback');
        exit.addEventListener('click', close); header.append(title, exit);
        const form = node('form');
        const intro = node('p', 'Your feedback helps us improve Relay. You can cancel without submitting.', 'relay-feedback-intro');
        const categoryLabel = node('label', 'Feedback type (required)');
        categoryLabel.htmlFor = 'relay-feedback-category';
        const category = node('select'); category.id = categoryLabel.htmlFor; category.required = true;
        const placeholder = node('option', 'Choose a type');
        placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true; category.append(placeholder);
        const detailLabel = node('label', 'Details (required)'); detailLabel.htmlFor = 'relay-feedback-details';
        const details = node('textarea'); details.id = detailLabel.htmlFor; details.required = true; details.rows = 4;
        details.placeholder = rating === 'up' ? 'Tell us what worked well…' : 'Describe the issue or what you expected…';
        details.maxLength = 4000;
        const hint = node('p', 'Up to 4,000 characters. Feedback is saved with this response and your account.', 'relay-feedback-hint');
        hint.id = 'relay-feedback-hint'; details.setAttribute('aria-describedby', hint.id);
        const error = node('p', '', 'relay-feedback-error'); error.setAttribute('role', 'alert');
        const actions = node('div', undefined, 'relay-feedback-actions');
        const cancel = node('button', 'Cancel', 'relay-feedback-cancel'); cancel.type = 'button'; cancel.addEventListener('click', close);
        const submit = node('button', 'Submit feedback', 'relay-feedback-submit'); submit.type = 'submit'; submit.disabled = true;
        actions.append(cancel, submit);
        form.append(intro, categoryLabel, category, detailLabel, details, hint, error, actions);
        dialog.append(header, form);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const targets = [...current.querySelectorAll('button:not(:disabled), select, textarea')];
            const first = targets[0], last = targets.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        });
        dialog.addEventListener('click', event => {
            if (event.target !== current) return;
            const rect = current.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        });
        document.body.append(dialog); dialog.showModal(); category.focus();
        details.addEventListener('input', () => details.setCustomValidity(''));
        try {
            const identity = await window.relayGetSession();
            for (const [value, label] of Object.entries(identity.feedback_categories)) {
                const option = node('option', label); option.value = value; category.append(option);
            }
            details.maxLength = identity.feedback_max_details; submit.disabled = false;
        } catch (failure) { error.textContent = failure.message; }
        let sending = false;
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (sending) return;
            details.setCustomValidity(details.value.trim() ? '' : 'Please add written details before submitting.');
            if (!form.reportValidity()) return;
            sending = true; submit.disabled = true; submit.textContent = 'Submitting…'; error.textContent = '';
            try {
                await window.relayPost('/relay/feedback', {turn_id: turn, feedback_id: feedbackId, rating,
                    category: category.value, details: details.value});
                markSubmitted(turn, rating); if (dialog === current) close();
                announce('Thank you. Your feedback was saved.');
            } catch (failure) {
                error.textContent = failure.message;
                if (!current.isConnected) announce('Feedback could not be saved. Reopen feedback to try again.');
            } finally { sending = false; submit.disabled = false; submit.textContent = 'Submit feedback'; }
        });
    }
    const mount = () => {
        const added = [];
        document.querySelectorAll('#chat .bot-row .relay-response-marker').forEach(marker => {
            // Gradio strips data attributes from answer HTML, but keeps classes.
            const turn = [...marker.classList].find(name => name.startsWith('relay-turn-'))?.slice(11);
            if (!/^[a-f0-9]{32}$/.test(turn) || marker.dataset.feedbackMounted) return;
            marker.dataset.feedbackMounted = 'true';
            marker.dataset.relayTurn = turn;
            const row = node('div', undefined, 'relay-feedback-row'); row.dataset.relayTurn = turn;
            row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Feedback on this response');
            for (const [rating, label] of [['up', 'Helpful'], ['down', 'Not helpful']]) {
                const button = node('button', undefined, 'relay-feedback-vote');
                button.type = 'button'; button.dataset.rating = rating; button.title = label;
                button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', 'false');
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
                icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7');
                icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
                for (const d of ['M7 10v12', 'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L13 2a3.13 3.13 0 0 1 2 3.88Z']) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', d); icon.append(path);
                }
                button.append(icon); button.addEventListener('click', () => open(button)); row.append(button);
            }
            row.append(node('span', '', 'relay-feedback-saved')); marker.after(row); added.push(turn);
        });
        if (added.length) {
            window.relayRecordVisible?.();
            for (let i = 0; i < added.length; i += 100)
                window.relayPost('/relay/feedback/status', {turn_ids: added.slice(i, i + 100)})
                    .then(values => Object.entries(values).forEach(([turn, value]) => markSubmitted(turn, value.rating))).catch(() => {});
        }
    };
    new MutationObserver(() => {
        clearTimeout(mountTimer); mountTimer = setTimeout(mount, 30);
    }).observe(document.querySelector('#chat') || document.body, {childList: true, subtree: true});
    mount();
}
)();
(() => {
    if (window.relayTablesStarted) return;
    window.relayTablesStarted = true;
    const tables = new Map();
    let frame = 0, nextId = 0;
    const update = (table, hint) => {
        const overflowing = table.scrollWidth > table.clientWidth + 1;
        hint.hidden = !overflowing;
        if (overflowing) {
            table.tabIndex = 0;
            table.setAttribute("aria-describedby", hint.id);
        } else {
            table.removeAttribute("tabindex");
            table.removeAttribute("aria-describedby");
        }
    };
    const resize = new ResizeObserver(entries => {
        for (const {target} of entries) {
            const hint = tables.get(target);
            if (hint) update(target, hint);
        }
    });
    const sync = () => {
        frame = 0;
        for (const [table, hint] of tables) {
            if (!table.isConnected) {
                resize.unobserve(table);
                hint.remove();
                tables.delete(table);
            }
        }
        for (const table of document.querySelectorAll("#chat .bot-row .prose table, #chat .relay-source-layout")) {
            if (!tables.has(table)) {
                const hint = document.createElement("p");
                const isTable = table.matches("table");
                hint.className = isTable ? "relay-table-hint" : "relay-source-hint";
                hint.id = `relay-table-hint-${++nextId}`;
                hint.textContent = isTable ? "Scroll horizontally to see all columns."
                    : "Scroll horizontally to read the source columns.";
                hint.hidden = true;
                table.after(hint);
                tables.set(table, hint);
                resize.observe(table);
            }
            update(table, tables.get(table));
        }
    };
    // Gradio replaces answer markup while streaming and restoring saved chats.
    // Observe content and size; never change source text, cells or snapshots.
    new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(sync);
    }).observe(document.body, {childList: true, subtree: true, characterData: true});
    sync();
}
)();
(function relayArtifactCanvas() {
    if (window.relayCanvas) return;
    let current;
    const workspace = document.querySelector('#relay-workspace');
    const mount = document.querySelector('#relay-canvas-mount');
    if (!workspace || !mount) return;
    const node = (tag, cls, text) => {
        const element = document.createElement(tag);
        element.className = cls;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    function close(restoreFocus = true) {
        if (!current) return;
        const previous = current;
        current = null;
        previous.controller.abort();
        previous.panel.close();
        previous.panel.remove();
        workspace.classList.remove('relay-canvas-split');
        if (restoreFocus) {
            const target = previous.opener?.isConnected ? previous.opener : document.querySelector('#composer textarea');
            target?.focus({preventScroll: true});
        }
    }
    function layout() {
        if (!current) return;
        const split = workspace.getBoundingClientRect().width >= 900 && innerHeight > 500;
        if (split === current.split) return;
        const focused = document.activeElement;
        current.panel.close();
        workspace.classList.toggle('relay-canvas-split', split);
        current.panel.classList.toggle('relay-canvas-docked', split);
        current.panel.setAttribute('aria-modal', String(!split));
        (split ? mount : document.body).append(current.panel);
        current.panel[split ? 'show' : 'showModal']();
        current.split = split;
        if (current.panel.contains(focused)) focused.focus({preventScroll: true});
    }
    window.relayCanvas = {
        close,
        open({kind, title, label, opener}) {
            close(false);
            const controller = new AbortController();
            const panel = node('dialog', 'relay-canvas');
            panel.dataset.kind = kind;
            panel.setAttribute('aria-label', label);
            const header = node('header', 'relay-canvas-header');
            const identity = node('div', 'relay-canvas-identity');
            identity.append(node('span', 'relay-canvas-kind', kind.charAt(0).toUpperCase() + kind.slice(1)));
            const heading = node('strong', 'relay-canvas-title', title);
            identity.append(heading);
            const button = node('button', 'relay-canvas-close', 'Close');
            button.type = 'button';
            button.addEventListener('click', () => close());
            header.append(identity, button);
            const toolbar = node('div', 'relay-document-toolbar');
            const content = node('div', 'relay-canvas-content');
            panel.append(header, toolbar, content);
            panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
            current = {panel, controller, opener};
            layout();
            button.focus({preventScroll: true});
            return {panel, toolbar, content, signal: controller.signal,
                setTitle(value) { heading.textContent = value; heading.title = value; }};
        },
    };
    new ResizeObserver(layout).observe(workspace);
    window.addEventListener('resize', layout);
    document.addEventListener('keydown', event => {
        // Leave a separate modal (such as response feedback) in charge of Escape.
        if (event.key === 'Escape' && current?.split && !document.querySelector('dialog:modal')) {
            event.preventDefault(); close();
        }
    });
    document.addEventListener('click', event => {
        if (event.target.closest?.('#new-chat, a[href="logout"]')) close(false);
    }, true);
    document.addEventListener('relay-clear-chat', () => close(false));
}
)();
(function relayDocumentPreview() {
    if (window.relayDocumentPreviewInstalled || !window.relayCanvas) return;
    window.relayDocumentPreviewInstalled = true;
    const node = (tag, text, cls) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (cls) element.className = cls;
        return element;
    };
    const button = (text, click) => {
        const element = node('button', text);
        element.type = 'button';
        element.addEventListener('click', click);
        return element;
    };
    const link = (text, href) => {
        const element = node('a', text);
        element.href = href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
        return element;
    };
    async function fetchSource(path, signal, status) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', signal});
            if (response.status !== 503 || attempt === 2) return response;
            status.textContent = 'The source preview is busy. Retrying…';
            await new Promise(resolve => setTimeout(resolve, 2000));
            signal.throwIfAborted();
        }
    }
    function sourceText(data) {
        const body = node('div', undefined, 'relay-document-text');
        body.id = 'relay-document-text';
        body.append(node('p', data.description, 'relay-document-note'),
            node('p', data.expiry, 'relay-document-note'));
        if (data.partial) body.append(node('p', 'Partial extraction: some source text may be missing or unreadable.', 'relay-document-warning'));
        for (const block of data.blocks) {
            const section = node('section', undefined, 'relay-document-block');
            section.append(node('p', block.location, 'relay-document-location'));
            const text = node('pre', undefined, block.spatial ? 'relay-document-spatial' : '');
            if (block.spatial) {
                text.tabIndex = 0;
                text.setAttribute('aria-label', 'Source text; scroll horizontally for wide columns');
            }
            if (block.highlight) {
                const [start, end] = block.highlight;
                const chars = Array.from(block.text); // Python offsets count code points.
                text.append(document.createTextNode(chars.slice(0, start).join('')),
                    node('mark', chars.slice(start, end).join('')),
                    document.createTextNode(chars.slice(end).join('')));
            } else text.textContent = block.text;
            section.append(text);
            body.append(section);
        }
        return body;
    }
    function pdfPages(data, view, base, text) {
        const doc = data.document;
        if (doc?.format !== 'pdf' || doc.page_url !== base + '/page' ||
            !Number.isInteger(doc.page_count) || doc.page_count < 1 || doc.page_count > 500 ||
            !Number.isInteger(doc.initial_page) || doc.initial_page < 1 || doc.initial_page > doc.page_count) return false;
        const pdf = node('div', undefined, 'relay-document-pdf');
        pdf.id = 'relay-document-pdf';
        const controls = node('div', undefined, 'relay-document-page-controls');
        const stage = node('div', undefined, 'relay-document-page-stage');
        stage.tabIndex = 0;
        stage.setAttribute('aria-label', 'PDF page; scroll to see the whole page');
        const status = node('p', '', 'relay-document-status');
        status.setAttribute('role', 'status');
        let number = doc.initial_page, controller, blobURL, zoomed = false;
        const input = node('input');
        input.type = 'number'; input.min = '1'; input.max = String(doc.page_count);
        input.value = String(number);
        input.setAttribute('aria-label', 'Page number');
        const previous = button('Previous', () => load(number - 1));
        const next = button('Next', () => load(number + 1));
        const label = node('label', 'Page ');
        label.append(input, document.createTextNode(' of ' + doc.page_count));
        const cited = button('Cited page', () => load(doc.initial_page));
        const zoom = button('Zoom in', () => {
            zoomed = !zoomed;
            zoom.textContent = zoomed ? 'Fit width' : 'Zoom in';
            const image = stage.querySelector('img');
            if (image) image.style.width = zoomed ? '175%' : '100%';
        });
        input.addEventListener('change', () => load(Number(input.value)));
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); load(Number(input.value)); }
        });
        controls.append(previous, label, next, cited, zoom);
        pdf.append(controls, node('p', 'Original PDF pages. See Source text for the highlighted quotation.', 'relay-document-note'), stage);
        if (doc.truncated) controls.after(node('p', 'Preview is limited to the first 500 pages. Download the original to see the rest.', 'relay-document-warning'));
        const clearImage = () => { if (blobURL) URL.revokeObjectURL(blobURL); blobURL = null; };
        view.signal.addEventListener('abort', () => { controller?.abort(); clearImage(); }, {once: true});
        async function load(wanted) {
            if (view.signal.aborted) return;
            if (!Number.isInteger(wanted) || wanted < 1 || wanted > doc.page_count) {
                input.value = String(number); return;
            }
            controller?.abort(); controller = new AbortController();
            const signal = controller.signal;
            clearImage();
            number = wanted; input.value = String(number);
            previous.disabled = number === 1; next.disabled = number === doc.page_count;
            status.textContent = 'Loading page ' + number + '…';
            stage.replaceChildren(status);
            const direct = window.relayDemo?.pageImage?.(doc.page_url, number);  // demo: a bundled page image
            if (direct) {
                const image = node('img');
                image.alt = data.filename + ', page ' + number;
                image.src = direct;
                image.style.width = zoomed ? '175%' : '100%';
                image.addEventListener('error', () => {
                    if (!signal.aborted) { status.textContent = 'This page could not be displayed. Use Source text or download the original.'; stage.replaceChildren(status); }
                });
                stage.replaceChildren(image);
                stage.scrollTop = 0;
                return;
            }
            try {
                const response = await fetchSource(doc.page_url + '?number=' + number, signal, status);
                if (!response.ok) {
                    const error = await response.json();
                    signal.throwIfAborted();
                    status.textContent = error.error || 'This page is unavailable. Use Source text or download the original.';
                    return;
                }
                if (!response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Invalid page');
                const blob = await response.blob();
                signal.throwIfAborted();
                blobURL = URL.createObjectURL(blob);
                const image = node('img');
                image.alt = data.filename + ', page ' + number;
                image.src = blobURL;
                image.style.width = zoomed ? '175%' : '100%';
                image.addEventListener('error', () => {
                    if (!signal.aborted) { status.textContent = 'This page could not be displayed. Use Source text or download the original.'; stage.replaceChildren(status); }
                });
                stage.replaceChildren(image);
                stage.scrollTop = 0;
            } catch (_) {
                if (!signal.aborted) status.textContent = 'The PDF page could not be loaded. Use Source text or download the original.';
            }
        }
        const tabs = node('div', undefined, 'relay-document-tabs');
        tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Document view');
        const original = button('PDF pages', () => select(true));
        const extracted = button('Source text', () => select(false));
        original.setAttribute('aria-controls', pdf.id); extracted.setAttribute('aria-controls', text.id);
        tabs.append(original, extracted);
        view.content.replaceChildren(tabs, pdf, text);
        function select(showPDF) {
            pdf.hidden = !showPDF; text.hidden = showPDF;
            original.setAttribute('aria-pressed', String(showPDF));
            extracted.setAttribute('aria-pressed', String(!showPDF));
        }
        select(true);
        load(number);
        return true;
    }
    async function open(anchor) {
        const url = new URL(anchor.href, location.href);
        if (url.origin !== location.origin || !/(?:^|\/)relay\/documents\/[A-Za-z0-9_-]{43}\/preview$/.test(url.pathname)) return;
        const view = window.relayCanvas.open({kind: 'document', title: 'Source preview', label: 'Document source preview', opener: anchor});
        const {signal, content, toolbar} = view;
        const status = node('p', 'Opening the verified source…', 'relay-document-status');
        status.setAttribute('role', 'status');
        content.append(status);
        try {
            const base = url.pathname.replace(/\/preview$/, '');
            const response = await fetchSource(base + '/data', signal, status);
            const data = await response.json();
            signal.throwIfAborted();
            if (!response.ok) { status.textContent = data.error || 'The source preview is unavailable. Reopen it to try again.'; return; }
            view.setTitle(data.filename);
            toolbar.append(node('p', data.location, 'relay-document-position'));
            const actions = node('nav', undefined, 'relay-document-actions');
            if (data.download === base + '/download') actions.append(link('Download original', data.download));
            if (typeof data.original === 'string' && new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/original#page=[1-9][0-9]*$').test(data.original))
                actions.append(link('Open original PDF at cited page', data.original));
            window.relayDemo?.links?.(actions, data, base);  // demo: files ship with the page
            toolbar.append(actions);
            const text = sourceText(data);
            content.replaceChildren(text);
            if (!pdfPages(data, view, base, text)) {
                const highlight = text.querySelector('mark');
                if (highlight) text.scrollTop = Math.max(0, highlight.getBoundingClientRect().top - text.getBoundingClientRect().top - 160);
            }
        } catch (_) {
            if (!signal.aborted) { status.textContent = 'The source preview could not be loaded. Check your connection and reopen it to try again.'; content.replaceChildren(status); }
        }
    }
    document.addEventListener('click', event => {
        const anchor = event.target.closest?.('#chat a.relay-preview-link');
        if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
        const url = new URL(anchor.href, location.href);
        if (url.origin !== location.origin || !/(?:^|\/)relay\/documents\/[A-Za-z0-9_-]{43}\/preview$/.test(url.pathname)) return;
        event.preventDefault(); open(anchor);
    });
    // The server emits this marker only for an explicit preview request. Restored
    // chat removes the auto-open class, so reload never replays a viewing action.
    const opened = new Set();
    const chat = document.querySelector('#chat');
    const discover = () => {
        for (const anchor of chat.querySelectorAll('a.relay-preview-auto')) {
            if (!opened.has(anchor.href)) { opened.add(anchor.href); open(anchor); }
        }
    };
    if (chat) new MutationObserver(discover).observe(chat, {childList: true, subtree: true});
}
)();
(function relayChartPreview(rendererURL) {
    if (window.relayChartPreviewInstalled || !window.relayCanvas) return;
    window.relayChartPreviewInstalled = true;
    let renderer;
    const opened = new Set();
    const node = (tag, text, cls) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (cls) element.className = cls;
        return element;
    };
    // Plotly supports a small HTML subset. Treat every report label as text.
    const escaped = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    function loadRenderer() {
        if (window.Plotly) return Promise.resolve(window.Plotly);
        if (!renderer) renderer = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = rendererURL;
            script.onload = () => window.Plotly ? resolve(window.Plotly) : reject(new Error('Chart renderer unavailable.'));
            script.onerror = () => { script.remove(); renderer = undefined; reject(new Error('Chart renderer could not load. Close and reopen the chart to retry.')); };
            document.head.append(script);
        });
        return renderer;
    }
    function formatted(value, format) {
        if (value === null) return 'Unknown';
        if (format === 'money') return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(value);
        return new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(value) + (format === 'percent' ? '%' : '');
    }
    // Short labels beside bars; hover text and the data table keep exact values.
    function compact(value, format) {
        if (value === null) return '';
        if (format === 'percent') return new Intl.NumberFormat('en-US', {maximumFractionDigits: 1}).format(value) + '%';
        const money = format === 'money' ? {style: 'currency', currency: 'USD'} : {};
        const small = Math.abs(value) < (format === 'money' ? 10000 : 100000);
        return new Intl.NumberFormat('en-US', small ? {...money, minimumFractionDigits: 0, maximumFractionDigits: format === 'money' ? 0 : 1}
            : {...money, notation: 'compact', maximumSignificantDigits: 3}).format(value);
    }
    // Wrap category names rather than cutting them at a fixed length, so similar
    // project names stay distinguishable. An overlong name keeps its first lines
    // and its ending, which often tells related projects apart.
    function wrap(label, width, maxLines) {
        const lines = [];
        for (const word of String(label).trim().split(/\s+/)) {
            for (let start = 0; start < word.length; start += width) {
                const piece = word.slice(start, start + width), last = lines.length - 1;
                if (!start && last >= 0 && lines[last].length + 1 + piece.length <= width) lines[last] += ' ' + piece;
                else lines.push(piece);
            }
        }
        if (lines.length <= maxLines) return lines;
        return [...lines.slice(0, maxLines - 2), lines[maxLines - 2] + ' …', lines[lines.length - 1]];
    }
    function categoryLines(labels, width) {
        const result = labels.map(label => wrap(label, width, 3));
        const groups = new Map();
        result.forEach((lines, i) => groups.set(lines.join('\n'), [...(groups.get(lines.join('\n')) || []), i]));
        for (const indices of groups.values()) {
            if (indices.length > 1) for (const i of indices) result[i] = wrap(labels[i], width, 12);
        }
        return result;
    }
    async function open(anchor) {
        const url = new URL(anchor.href, location.href);
        if (url.origin !== location.origin || !/(?:^|\/)relay\/charts\/[A-Za-z0-9_-]{43}\/data$/.test(url.pathname)) return;
        const view = window.relayCanvas.open({kind: 'chart', title: 'Report chart', label: 'Report chart', opener: anchor});
        const status = node('p', 'Loading chart…', 'relay-document-status');
        status.setAttribute('role', 'status');
        view.content.append(status);
        try {
            const response = await fetch(url.pathname, {credentials: 'same-origin', cache: 'no-store', signal: view.signal});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'This chart is unavailable.');
            view.signal.throwIfAborted();
            if (data.version !== 1 || !Array.isArray(data.series) || !data.series.length || data.labels.length > 100) throw new Error('Unsupported chart data.');
            view.setTitle(data.title);
            const controls = node('div', undefined, 'relay-chart-controls');
            const kind = node('select'); kind.setAttribute('aria-label', 'Chart type');
            for (const [value, label] of [['bar', 'Bar chart'], ...(data.temporal ? [['line', 'Line chart']] : [])]) {
                const option = node('option', label); option.value = value; kind.append(option);
            }
            kind.value = data.type;
            const measures = node('select'); measures.setAttribute('aria-label', 'Chart measure');
            const options = [];
            for (const format of ['money', 'number', 'percent']) {
                const group = data.series.filter(s => s.format === format);
                if (group.length > 1) options.push({label: format === 'money' ? 'Compare dollar measures' : format === 'percent' ? 'Compare percentages' : 'Compare numeric measures', ids: group.map(s => s.id)});
            }
            for (const series of data.series) options.push({label: series.label, ids: [series.id]});
            if (!options.some(o => JSON.stringify(o.ids) === JSON.stringify(data.selected))) options.unshift({label: 'Requested measures', ids: data.selected});
            options.forEach((item, index) => {
                const option = node('option', item.label); option.value = String(index); measures.append(option);
            });
            measures.value = String(options.findIndex(o => JSON.stringify(o.ids) === JSON.stringify(data.selected)));
            const kindLabel = node('label', 'View '), measureLabel = node('label', 'Measure ');
            kindLabel.append(kind); measureLabel.append(measures); controls.append(kindLabel, measureLabel);
            view.toolbar.append(controls);
            const scroll = node('div', undefined, 'relay-chart-scroll');
            const plot = node('div', undefined, 'relay-chart-plot');
            plot.setAttribute('role', 'img');
            const empty = node('p', 'This measure has no recorded values. Unknown values are not drawn as zero.', 'relay-chart-empty');
            empty.hidden = true;
            const description = node('p', data.description, 'relay-chart-description');
            const legend = node('ul', undefined, 'relay-chart-legend');
            legend.setAttribute('aria-label', 'Chart legend');
            const caveat = node('p', '', 'relay-chart-note');
            const freshness = node('p', 'Source: e-Builder warehouse · ' + (data.as_of || 'Refresh time unavailable'), 'relay-chart-note');
            const rows = data.source_rows;
            const coverage = node('p', `${rows} report row${rows === 1 ? '' : 's'} plotted, with the same values as this answer. ${data.expiry}`, 'relay-chart-note');
            const details = node('details', undefined, 'relay-chart-data');
            details.append(node('summary', 'View chart data'));
            const table = node('table'); details.append(table);
            scroll.append(description, legend, empty, plot, caveat, freshness, coverage, details);
            view.content.append(scroll);
            const Plotly = await loadRenderer();
            view.signal.throwIfAborted();
            status.remove();
            let frame, drawing = Promise.resolve();
            function draw() {
                if (view.signal.aborted) return;
                const selected = data.series.filter(s => options[Number(measures.value)].ids.includes(s.id));
                const line = kind.value === 'line';
                const horizontal = !line && data.orientation === 'horizontal';
                const dark = document.body.classList.contains('dark');
                const colors = dark ? ['#57c9c0', '#8babf1', '#e9b95f', '#c999e9'] : ['#16776f', '#486bbe', '#b77816', '#8f55b4'];
                const ink = dark ? '#e3eaf5' : '#26364a', grid = dark ? '#334254' : '#e4e9ef';
                // Name what is plotted: the report title can mention measures that are not selected.
                const title = selected.length > 2 ? data.title
                    : selected.map(s => s.label).join(' and ') + (data.category === 'Report total' ? '' : ' by ' + data.category);
                view.setTitle(title);
                plot.setAttribute('aria-label', title + '. Exact values are in the data table below.');
                legend.hidden = selected.length < 2;
                legend.replaceChildren(...selected.map((series, i) => {
                    const item = node('li'), swatch = node('span', undefined, 'relay-chart-swatch');
                    swatch.style.backgroundColor = colors[i]; swatch.setAttribute('aria-hidden', 'true');
                    item.append(swatch, node('span', series.label));
                    return item;
                }));
                // Monthly charts add zero months between returned ones; nulls are unknown values.
                const filled = data.temporal ? data.labels.length - data.source_rows : 0;
                const unknown = selected.some(s => s.values.includes(null));
                caveat.textContent = [data.note, unknown && 'Unknown values are left blank, not drawn as zero.',
                    filled > 0 && 'Months with no matching paid invoices are shown as zero.'].filter(Boolean).join(' ');
                table.replaceChildren();
                const head = node('thead'), row = node('tr');
                for (const label of [data.category, ...selected.map(s => s.label)]) { const th = node('th', label); th.scope = 'col'; row.append(th); }
                head.append(row); table.append(head);
                const body = node('tbody');
                data.labels.forEach((label, i) => {
                    const row = node('tr'); row.append(node('td', label));
                    for (const series of selected) row.append(node('td', formatted(series.values[i], series.format)));
                    body.append(row);
                });
                table.append(body);
                const values = selected.flatMap(s => s.values).filter(v => v !== null);
                empty.hidden = values.length > 0;
                plot.hidden = !values.length;
                if (!values.length) {
                    drawing = drawing.then(() => Plotly.purge(plot));
                    return;
                }
                const width = scroll.clientWidth || 600, narrow = width < 560;
                const chars = Math.max(10, Math.floor(Math.min(240, Math.max(96, width * (narrow ? 0.36 : 0.3))) / 6.4));
                const lines = horizontal ? categoryLines(data.labels, chars) : [];
                const positions = data.temporal ? data.labels : data.labels.map((_, i) => i);
                // Value labels on horizontal bars always have their own row; vertical
                // bars get them only when each bar has room for one.
                const showValues = !line && (horizontal || width / (data.labels.length * selected.length) >= 38);
                const slot = Math.max(30, Math.max(1, ...lines.map(l => l.length)) * 14 + 10, selected.length * 18 + 10);
                const axisTop = horizontal && data.labels.length * slot > 440;  // keep the scale in view on long charts
                const margin = {l: 8, r: 16, t: axisTop ? 40 : 18, b: horizontal ? (axisTop ? 12 : 36) : 40};
                const height = horizontal ? data.labels.length * slot + margin.t + margin.b : 390;
                const format = selected[0].format;
                // Reserve room beyond the longest bars for their value labels, in
                // pixels converted to data units, so labels never cover category names.
                const low = Math.min(0, ...values), high = Math.max(0, ...values);
                const labelColumn = horizontal ? Math.max(...lines.flat().map(text => text.length)) * 6.4 + 14 : 56;
                const along = horizontal ? Math.max(80, width - 24 - labelColumn - margin.r) : height - margin.t - margin.b;
                const room = side => !side.length ? 0 : horizontal ? Math.max(...side.map(v => compact(v, format).length)) * 6.6 + 8 : 18;
                const above = room(values.filter(v => v >= 0)), below = room(values.filter(v => v < 0));
                const span = (high - low || 1) / (1 - Math.min(0.6, (above + below) / along));
                const numeric = {rangemode: 'tozero', gridcolor: grid, zerolinecolor: dark ? '#8090a4' : '#8190a2', separatethousands: true,
                    tickprefix: format === 'money' ? '$' : '', ticksuffix: format === 'percent' ? '%' : '', automargin: true,
                    ...(showValues ? {range: [low - below / along * span, high + above / along * span]} : {}),
                    ...(axisTop ? {side: 'top'} : {})};
                const category = data.temporal ? {type: 'date', tickformat: '%b %Y', automargin: true, gridcolor: grid} : {
                    tickmode: 'array', tickvals: positions, showgrid: false, automargin: true,
                    ticktext: horizontal ? lines.map(l => l.map(escaped).join('<br>')) : data.labels.map(escaped),
                    ...(horizontal ? {autorange: 'reversed'} : {})};
                const traces = selected.map((s, i) => ({
                    type: line ? 'scatter' : 'bar', mode: 'lines+markers', connectgaps: false,
                    name: escaped(s.label), x: horizontal ? s.values : positions, y: horizontal ? positions : s.values,
                    orientation: horizontal ? 'h' : 'v', marker: {color: colors[i], size: 7}, line: {color: colors[i], width: 2.5},
                    ...(showValues ? {text: s.values.map(v => escaped(compact(v, s.format))), textposition: 'outside',
                        cliponaxis: false, constraintext: 'none', textfont: {size: 11, color: ink}} : {}),
                    customdata: data.labels.map((label, n) => [escaped(label), escaped(formatted(s.values[n], s.format))]),
                    hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<extra>' + escaped(s.label) + '</extra>',
                }));
                const layout = {autosize: true, height, barmode: 'group', bargap: 0.25, bargroupgap: 0.08, showlegend: false,
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', hoverlabel: {namelength: -1},
                    font: {family: 'Inter, system-ui, sans-serif', size: 11, color: ink}, margin,
                    xaxis: horizontal ? numeric : category, yaxis: horizontal ? category : numeric};
                plot.style.height = height + 'px';
                drawing = drawing.then(() => view.signal.aborted ? undefined : Plotly.react(plot, traces, layout,
                    {displayModeBar: false, responsive: false, scrollZoom: false, locale: 'en-US'})).catch(() => {
                    if (!view.signal.aborted) { plot.replaceChildren(node('p', 'The chart could not render. Use View chart data below.')); }
                });
            }
            const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
            kind.addEventListener('change', schedule); measures.addEventListener('change', schedule);
            let width = 0;
            const resize = new ResizeObserver(entries => {
                const next = entries[0].contentRect.width;
                if (Math.abs(next - width) > 1) { width = next; schedule(); }
            });
            resize.observe(scroll);
            const theme = new MutationObserver(schedule);
            theme.observe(document.body, {attributes: true, attributeFilter: ['class']});
            view.signal.addEventListener('abort', () => { cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); drawing.finally(() => Plotly.purge(plot)); }, {once: true});
            draw();
        } catch (error) {
            if (!view.signal.aborted) status.textContent = error.message || 'The chart could not load. Please reopen it.';
        }
    }
    document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a.relay-chart-link');
        if (!anchor || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); open(anchor);
    });
    const observer = new MutationObserver(() => {
        for (const anchor of document.querySelectorAll('#chat a.relay-chart-auto')) {
            if (opened.has(anchor.href)) continue;
            opened.add(anchor.href); open(anchor);
        }
    });
    observer.observe(document.querySelector('#chat'), {childList: true, subtree: true});
}
)("assets/vendor/plotly-basic.min.js");
(() => {
    if (window.relayMobileStarted) return;
    window.relayMobileStarted = true;
    // Match mobile.css, including short landscape phone windows.
    const compact = matchMedia('(max-width: 768px), (max-width: 950px) and (max-height: 500px)');
    const root = document.documentElement;
    const mount = () => {
        const sidebar = document.querySelector('#sidebar');
        const input = document.querySelector('#composer textarea');
        if (!sidebar || !input) return false;
        const toggle = sidebar.querySelector('.toggle-button');
        const content = sidebar.querySelector('.sidebar-content');
        const placeholder = input.placeholder;
        const backdrop = document.createElement('button');
        backdrop.className = 'relay-menu-backdrop';
        backdrop.type = 'button';
        backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', 'Close menu');
        backdrop.hidden = true;
        sidebar.closest('gradio-app').append(backdrop);
        input.setAttribute('enterkeyhint', 'send');
        input.setAttribute('aria-label', 'Ask Relay');
        let wasModal = false, opener, returnFocus = true;
        const inerted = new Map();
        const close = (restore = true) => {
            if (!compact.matches || !sidebar.classList.contains('open')) return;
            returnFocus = restore;
            toggle.click();
        };
        const sync = () => {
            const mobile = compact.matches;
            const open = sidebar.classList.contains('open');
            const modal = mobile && open;
            input.placeholder = mobile ? 'Ask about your projects…' : placeholder;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', mobile ? (open ? 'Close sidebar menu' : 'Open sidebar menu') : 'Toggle Sidebar');
            content.inert = mobile && !open;
            backdrop.hidden = !modal;
            if (modal) {
                if (!wasModal) opener = document.activeElement;
                sidebar.setAttribute('role', 'dialog');
                sidebar.setAttribute('aria-modal', 'true');
                sidebar.setAttribute('aria-label', 'Relay menu');
                for (const sibling of sidebar.parentElement.children) {
                    if (sibling !== sidebar && !inerted.has(sibling)) {
                        inerted.set(sibling, sibling.inert);
                        sibling.inert = true;
                    }
                }
                if (!wasModal) {
                    toggle.focus({preventScroll: true});
                }
            } else {
                sidebar.removeAttribute('role');
                sidebar.removeAttribute('aria-modal');
                sidebar.removeAttribute('aria-label');
                for (const [element, original] of inerted) element.inert = original;
                inerted.clear();
                if (wasModal && returnFocus && opener?.isConnected) opener.focus({preventScroll: true});
                returnFocus = true;
            }
            wasModal = modal;
            viewport();
        };
        const viewport = () => {
            if (!compact.matches) {
                root.style.removeProperty('--r-mobile-height');
                root.style.removeProperty('--r-mobile-top');
                return;
            }
            const view = window.visualViewport;
            // Respect pinch zoom. It is a reading aid, not a keyboard resize.
            if (view && Math.abs(view.scale - 1) > 0.01) return;
            root.style.setProperty('--r-mobile-height', `${view?.height ?? innerHeight}px`);
            root.style.setProperty('--r-mobile-top', `${view?.offsetTop ?? 0}px`);
        };
        backdrop.addEventListener('click', () => close());
        document.addEventListener('click', event => {
            if (!compact.matches) return;
            if (event.target.closest?.('.mobile-samples')) toggle.click();
            if (event.target.closest?.('#sidebar .qitem')) close(false);
        });
        document.addEventListener('keydown', event => {
            if (!wasModal) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            } else if (event.key === 'Tab') {
                const targets = [...sidebar.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')]
                    .filter(element => element.getClientRects().length && !element.closest('[inert]'));
                const first = targets[0], last = targets.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault(); last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first?.focus();
                }
            }
        });
        new MutationObserver(sync).observe(sidebar, {attributes: true, attributeFilter: ['class']});
        compact.addEventListener('change', sync);
        window.addEventListener('resize', viewport);
        window.visualViewport?.addEventListener('resize', viewport);
        window.visualViewport?.addEventListener('scroll', viewport);
        sync();
        return true;
    };
    if (!mount()) {
        const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
        observer.observe(document.body, {childList: true, subtree: true});
    }
}
)();
((limit, countFrom) => {
    if (window.relayComposerStarted) return;
    window.relayComposerStarted = true;
    // The chat box's own rules, on top of Gradio's textbox:
    // - Send and Stop get names and tooltips.
    // - From countFrom characters a count appears; above the limit the draft stays
    //   whole for editing, but Enter and Send are held (the assistant also refuses it).
    // - A question sent while Relay is busy is queued and sent once Relay is ready.
    //   Busy lasts from a send until the app's relay-answer-settled event: an answer
    //   completed, failed, or finished cancelling after Stop. Without this, Gradio's
    //   take step would empty the box and the question would be silently skipped.
    //   New chat cancels a queued question.
    // Gradio owns the textbox value and sending; this reads the value, labels the
    // buttons and holds key presses and clicks that must not submit yet.
    const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    let input = null, queued = false, busy = false, sendTimer = 0, noteTimer = 0, watchdog = 0;
    const $ = selector => document.querySelector(selector);
    const running = () => Boolean($('#composer .stop-button'));
    // Count as the assistant does: code points of the trimmed question.
    const size = text => [...String(text || '').trim()].length;
    const over = () => size(input?.value) > limit;
    const shorten = `Shorten your question to ${limit} characters to send it.`;
    const set = (element, name, value) => {
        if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
    };
    const label = () => {
        const send = $('#composer .submit-button'), stop = $('#composer .stop-button');
        set(send, 'aria-label', 'Send');
        set(send, 'title', 'Send (Enter)');
        set(send, 'aria-keyshortcuts', 'Enter');
        set(send, 'aria-disabled', String(over()));
        const action = queued ? 'Stop answering and send your next question' : 'Stop answering';
        set(stop, 'aria-label', action);
        set(stop, 'title', action);
    };
    const render = () => {
        const count = $('.relay-composer-count');
        if (!count || !input) return;
        if (queued && !input.value.trim()) {
            setQueued(false);  // Emptying the box cancels the queued question.
            return;
        }
        const n = size(input.value);
        const state = n > limit ? 'over' : n >= countFrom ? 'near' : '';
        count.dataset.state = state;
        count.textContent = state === 'over' ? `${n.toLocaleString('en-US')} / ${limit} · Shorten your question to send`
            : state ? `${n} / ${limit}` : '';
        $('#composer')?.classList.toggle('relay-over-limit', state === 'over');
        const note = $('.relay-composer-note');
        $('.relay-composer-help')?.classList.toggle('relay-composer-help-active',
                                                    Boolean(state || queued || note?.textContent));
        label();
    };
    const note = (text, ms, quiet = false) => {
        const element = $('.relay-composer-note');
        if (!element) return;
        clearTimeout(noteTimer);
        element.classList.toggle('relay-composer-note-quiet', quiet);  // Announced, not shown.
        element.replaceChildren(text);
        noteTimer = setTimeout(() => {
            if (!queued) element.replaceChildren();
            render();
        }, ms);
        render();
    };
    // A send held over the limit: the count already says why, so nudge it and tell
    // screen readers rather than repeat the text on screen.
    const refuse = () => {
        note(shorten, 6000, true);
        const count = $('.relay-composer-count');
        count?.classList.remove('relay-composer-nudge');
        void count?.offsetWidth;  // Restart the animation on repeated attempts.
        count?.classList.add('relay-composer-nudge');
    };
    const showQueued = () => {
        const element = $('.relay-composer-note');
        if (!element) return;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'relay-composer-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => {
            setQueued(false);
            input?.focus({preventScroll: true});
        });
        element.replaceChildren(running() ? 'Queued · sends when this answer finishes'
                                          : 'Queued · sends when Relay is ready', cancel);
    };
    function setQueued(value) {
        queued = value;
        clearTimeout(noteTimer);
        $('.relay-composer-note')?.classList.remove('relay-composer-note-quiet');
        if (value) showQueued();
        else $('.relay-composer-note')?.replaceChildren();
        render();
    }
    const userRows = () => document.querySelectorAll('#chat .message-row.user-row').length;
    const restore = text => {
        native.set.call(input, text);
        input.dispatchEvent(new Event('input', {bubbles: true}));
    };
    const submitted = text => {
        busy = true;
        clearTimeout(watchdog);
        const rows = userRows();
        // A safety net: if nothing started, Gradio dropped the send. Put the question
        // back rather than lose it.
        watchdog = setTimeout(() => {
            if (running() || userRows() > rows) return;
            busy = false;
            if (text.trim() && input && !input.value) {
                restore(text);
                note('Your question was not sent. Press Enter to send it.', 10000);
            }
        }, 10000);
    };
    const sendQueued = () => {
        if (!queued || busy || running() || !input) return;
        const text = input.value, send = $('#composer .submit-button');
        setQueued(false);
        if (!text.trim() || !send) return;
        if (size(text) > limit) {
            refuse();
            return;
        }
        send.click();  // Through the click handler below, like a person pressing Send.
    };
    const hold = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    // Capture phase, so these run before Gradio's own textbox and button handlers.
    // Gradio submits on Enter (without Shift) in this one-line textbox.
    window.addEventListener('keypress', event => {
        const box = event.target;
        if (event.key !== 'Enter' || event.shiftKey || !box?.matches?.('#composer textarea')) return;
        if (size(box.value) > limit) {
            hold(event);
            refuse();
        } else if (busy || running()) {
            hold(event);
            if (box.value.trim()) setQueued(true);
        } else {
            if (queued) setQueued(false);
            submitted(box.value);
        }
    }, true);
    window.addEventListener('click', event => {
        if (!event.target?.closest?.('#composer .submit-button')) return;
        if (over()) {
            hold(event);
            refuse();
        } else if (busy) {
            hold(event);
            if (input?.value.trim()) setQueued(true);
        } else {
            if (queued) setQueued(false);
            submitted(input?.value || '');
        }
    }, true);
    document.addEventListener('relay-answer-settled', () => {
        busy = false;
        clearTimeout(watchdog);
        if (queued) {
            clearTimeout(sendTimer);
            sendTimer = setTimeout(sendQueued, 60);
        }
        label();
    });
    document.addEventListener('relay-clear-chat', () => {
        clearTimeout(sendTimer);
        setQueued(false);
    });
    const bind = element => {
        input = element;
        // Gradio also sets the value directly (samples, follow-ups, clearing after
        // Send); keep the count in step with those changes too.
        Object.defineProperty(element, 'value', {
            configurable: true,
            get() { return native.get.call(this); },
            set(value) {
                native.set.call(this, value);
                queueMicrotask(render);
            },
        });
        element.addEventListener('input', render);
        set(element, 'aria-describedby', 'relay-composer-count');
        render();
    };
    let wasRunning = false;
    const sync = () => {
        const current = $('#composer textarea');
        if (current && current !== input) bind(current);
        const now = running();
        if (now !== wasRunning && queued) showQueued();  // Stop pressed: the wording changes.
        wasRunning = now;
        label();
    };
    const start = () => {
        const composer = $('#composer');
        if (!composer || !$('#composer-help')) return false;
        new MutationObserver(sync).observe(composer, {childList: true, subtree: true});
        sync();
        return true;
    };
    if (!start()) {
        const wait = new MutationObserver(() => { if (start()) wait.disconnect(); });
        wait.observe(document.body, {childList: true, subtree: true});
    }
}
)(500, 400);
window.RELAY_DEMO.ready();
})();