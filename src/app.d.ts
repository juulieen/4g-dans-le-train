// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/**
	 * Network Information API — non standard, absente sur Safari/iOS et Firefox.
	 * On la lit défensivement (voir src/lib/measure/netinfo.ts).
	 */
	interface NetworkInformation {
		readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
		readonly downlink?: number;
		readonly rtt?: number;
		readonly type?:
			| 'bluetooth'
			| 'cellular'
			| 'ethernet'
			| 'none'
			| 'wifi'
			| 'wimax'
			| 'other'
			| 'unknown';
	}
	interface Navigator {
		readonly connection?: NetworkInformation;
	}
}

export {};
