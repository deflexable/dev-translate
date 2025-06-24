
interface GoodResponse {
    success: boolean;
    commit: Response;
}

interface BadResponse {
    success: boolean;
    error: string;
}

interface DuplexProxyExtras {
    /**
     * number of proxy endpoint to access per each request
     * 
     * @default 3
     */
    jumper?: number;
    /**
     * maximum number of jumps for this Duplex instance
     * @default Infinity
     */
    jumps?: number;
    /**
     * request timeout when fetching resources from proxy endpoint
     * 
     * @default 30000
     */
    fetchTimeout?: number;
    /**
     * number of jumps before resting
     * @default 30
     */
    restIntervalCount?: number;
    /**
     * @default 30000
     */
    restTimer?: 30000;
    /**
     * filter out bad and good response from proxy endpoint.
     * 
     * good response can be acknowledge by returning
     * ```js
     *  { success: true, commit: response }
     * ```
     * 
     * bad response are acknowledge by returning
     * ```js
     * { success: false, error: 'some error message...' }
     * ```
     * 
     * This is recommend as it internally builds up a whitelist for speeding up future request calls and removes frequent failed proxy url.
     * 
     * by default all response are acknowledge as good.
     */
    ackResponse?: (response: Response, proxy: string) => Promise<GoodResponse | BadResponse>;
    /**
     * enable logging
     * @default false
     */
    logProxy?: boolean;
    proxyCrawlerUrlEntries?: string[];
    autoInstallProxies?: boolean;
    installer?: () => void;
}

interface ProxyVerse { }

interface DuplexProxyResult {
    __donot_modify_verse: ProxyVerse;
    add: (url: string) => void;
    fetch: (url: string, options: RequestInit) => Promise<Response>;
}

export function DuplexProxy(extras?: DuplexProxyExtras): DuplexProxyResult;