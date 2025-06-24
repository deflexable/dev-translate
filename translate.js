import translate from 'google-translate-api-x';
// import cld from 'cld';
import { parse, serialize } from 'parse5';
import { DuplexProxy } from './duplex_proxy.js';

const TRANSLATION_REDUCER = 90;
const TRANSLATION_MAX_CHARS = 3700;
const TRANSLATION_MAX_LENGTH = 170;

const translations = {
    ite: 0,
    timer: undefined,
    promises: {},
    lastDate: undefined,
    limiter: {
        count: 0,
        chars: 0
    }
};

const { fetch: doProxy } = DuplexProxy({
    ackResponse: async res => {
        if (
            (await res.clone().text()).startsWith(")]}'") &&
            res.status === 200
        ) return { commit: res, success: true };
    },
    logProxy: true,
    autoInstallProxies: true,
    proxyCrawlerUrlEntries: ['https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text&timeout=20000']
});

export const translateX = async (string, to = 'en') => {
    string = Array.isArray(string) ? string.map(v => `${v}`) : `${string}`;
    if (Array.isArray(string) ? !string.some(v => !!v.trim()) : !string.trim()) {
        return string;
    }
    const result = await Promise.all((Array.isArray(string) ? string : [string]).map(async text => {
        const stringPromise = [];
        const { document, stringifyNode } = useNode(text);
        const {
            document: documentCorrection,
            stringifyNode: stringifyNodeCorrection
        } = useNode(text);
        const srcRanking = {};

        const reparse = (node, correctionNode) => {
            if (!node) return;
            if (node.value) {
                stringPromise.push(
                    translateXCore(node.value, to).then(r => {
                        node.value = r.text;
                        correctionNode.value = r.correction || r.text;
                        if (srcRanking[r.src]) ++srcRanking[r.src];
                        else srcRanking[r.src] = 1;
                    })
                );
            }
            if (node.childNodes)
                node.childNodes.forEach((v, i) => {
                    reparse(v, correctionNode.childNodes[i]);
                });
        }
        reparse(document, documentCorrection);
        await Promise.all(stringPromise);

        const resultObj = {
            text: stringifyNode(),
            correction: stringifyNodeCorrection(),
            src: Object.entries(srcRanking).sort((a, b) => a[1] - b[1]).pop()?.[0]
        };

        if (resultObj.text === resultObj.correction)
            delete resultObj.correction;

        return resultObj;
    }));
    if (Array.isArray(string)) return result;
    return result[0];
};

const translateXCore = (string, to) => new Promise(resolve => {

    clearTimeout(translations.timer);

    if (!Number.isInteger(translations.lastDate))
        translations.lastDate = Date.now();

    translations.promises[++translations.ite] = [string, to, resolve];
    ++translations.limiter.count;
    translations.limiter.chars += (Array.isArray(string) ? string : [string]).join('').length;

    const dispatchTranslation = async () => {
        const prepromise = Object.values(translations.promises);

        translations.lastDate = undefined;
        translations.promises = {};
        translations.limiter.chars = 0;
        translations.limiter.count = 0;

        const promise = (
            await Promise.all(prepromise.map(async ([string, to, resolve]) => {

                const compare = await Promise.all((Array.isArray(string) ? string : [string]).map(async v => {
                    try {
                        if (!v.trim()) return { same: true, value: v, lang: 'en' };
                        // const d = await cld.detect(v);
                        const shouldFetch = true; // !d || !d.reliable || d.languages?.length !== 1 || d.languages[0].code !== to;
                        return shouldFetch ? v : { same: true, value: v, lang: to };
                    } catch (_) {
                        return v;
                    }
                }));
                if (compare.some(v => !v?.same)) return [compare, to, Array.isArray(string), resolve];
                resolve(Array.isArray(string) ? string.map(v => ({ text: v, src: to })) : { text: string, src: to });
            }))
        ).filter(v => v);

        try {
            const translateInput = promise.map(([string, to]) =>
                string.filter(v => !v?.same).map(s =>
                    ({ text: s, to, forceTo: true })
                )
            ).flat();

            const res = translateInput.length ? await translate(
                translateInput,
                { requestFunction: doProxy }
            ) : [];
            let offset = 0;

            promise.forEach(([strings, to, isArray, resolve]) => {
                const partial = strings.map(v => {
                    if (v?.same)
                        return {
                            src: v?.lang || 'en',
                            text: v.value
                        };

                    const slice = res.slice(offset, ++offset)[0];
                    return {
                        src: slice?.from?.language?.iso || to,
                        text: slice?.text || v,
                        correction: slice?.from?.text?.value
                    };
                });
                resolve(isArray ? partial : partial[0]);
            });
        } catch (e) {
            console.error('translateX err:', e);
            throw e;
        }
    };

    const dispatchTimeout = TRANSLATION_REDUCER - (Date.now() - translations.lastDate);
    const { chars, count } = translations.limiter;

    if (
        dispatchTimeout <= 0 ||
        chars >= TRANSLATION_MAX_CHARS ||
        count >= TRANSLATION_MAX_LENGTH
    ) {
        dispatchTranslation();
    } else {
        translations.timer = setTimeout(async () => {
            dispatchTranslation();
        }, dispatchTimeout);
    }
});

/**
 * @type {(document: import('parse5').DefaultTreeAdapterMap['document'], query: string)=> import('parse5').DefaultTreeAdapterMap['childNode'] | null}
 */
function parseSelector(document, query) {
    const [tag, attr, value] = query.includes('=') ? [undefined, query.split('=')[0], query.split('=').slice(1).join('=')] : [query];

    const findSelector = (node) => {
        if (tag ? node.nodeName === tag : (node.attrs || []).findIndex(v => v.name === attr && v.value === value) !== -1)
            return node;

        for (const thisNode of (node.childNodes || [])) {
            const k = findSelector(thisNode);
            if (k) return k;
        }
    }
    return document.childNodes.map(findSelector).filter(v => v)[0] || null;
};

function useNode(text) {
    const hasHtml = text.includes('<html');

    const tagAttr = 'stage-name';
    const tagValue = !hasHtml && `${Date.now()}`;
    const [prefixTag, suffixTag] = [`<div ${tagAttr}="${tagValue}">`, '</div>'];

    const document = parse(hasHtml ? text : `${prefixTag}${text}${suffixTag}`);

    return {
        document,
        stringifyNode: () => {
            if (hasHtml) return serialize(document);
            const node = parseSelector(document, `${tagAttr}=${tagValue}`);
            return serialize(node);
        }
    }
};