import fetch from 'node-fetch';
import { AppApis } from '../../shared_values/common_values';
import { Scope } from './variables';
import translate from 'google-translate-api-x';
import cld from 'cld';
import proxyFetch from './proxy_rotator';
import { IS_DEV } from '../env';
import { useNode } from './sanitize';
import { DuplexProxy } from './duplex_proxy';

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

const ProxyFetcher = DuplexProxy({});

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
                        const d = await cld.detect(v);
                        const shouldFetch = !d || !d.reliable || d.languages?.length !== 1 || d.languages[0].code !== to;
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
                {
                    requestFunction: async (url, opt) => {
                        if (IS_DEV) console.log('proxying url:', url, ' opt:', opt);
                        return proxyFetch(url, opt, {
                            jumpTimeout: 4000,
                            jumper: 3,
                            jumps: IS_DEV ? Infinity : 5,
                            flag: Scope.proxyVerse.flags.translation
                        })(async res => {
                            if (
                                (await res.clone().text()).startsWith(")]}'") &&
                                res.ok
                            ) {
                                return { commit: res, success: true };
                            }
                        });
                    }
                }
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

            if (IS_DEV || true) throw 'in dev mode'; // TODO:
            try {
                await Promise.all(
                    promise.map(async ([strings, to, isArray, resolve]) => {

                        const r = await (await fetch(AppApis.googleTranslationApi, {
                            body: JSON.stringify({
                                q: strings.filter(v => !v?.same),
                                target: to,
                                format: "text"
                            }),
                            headers: {
                                "Content-Type": "application/json"
                            },
                            method: 'POST'
                        })).json();
                        let offset = 0;

                        const results = r?.data?.translations,
                            resultArr = results ? strings.map(v => {
                                if (v.same) return { text: v.value, src: v.lang };
                                const res = results.slice(offset, ++offset)[0];

                                return {
                                    text: res.translatedText,
                                    src: res.detectedSourceLanguage
                                };
                            }) : strings.map(v => ({ text: v?.value || v, src: v?.lang || 'en' }));

                        resolve(isArray ? resultArr : resultArr[0]);

                        if (r.error || !Array.isArray(results))
                            throw r.error || new Error('Expected an array in googleTranslationApi');
                    })
                );
            } catch (e) {
                console.log('final translateX err:', e);
                promise.forEach(([strings, _, isArray, resolve]) => {
                    const result = strings.map(v => ({ text: v?.value || v, src: v?.lang || 'en' }));
                    resolve(isArray ? result : result[0]);
                });
                throw e;
            }
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