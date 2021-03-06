import * as Mobx from 'mobx';
import * as uuid from 'uuid';
import * as semver from 'semver';
import { PatternLibrary } from './pattern-library';
import { LibraryStoreItemType, LibraryStoreItemState } from './library-store';
import { Project } from './project';
import * as T from '@meetalva/types';
import * as M from '@meetalva/message';
import {
	PatternLibraryInstallType,
	PatternLibraryOrigin,
	PatternLibraryState
} from '@meetalva/types';

export interface LibraryStoreItemInit {
	id?: string;
	library?: PatternLibrary;
	meta?: Map<string, any>;
	type: LibraryStoreItemType;
	name: string;
	version: string;
}

export class LibraryStoreItem {
	public readonly id: string;
	private library?: PatternLibrary;
	private type: LibraryStoreItemType;
	private fetching?: Promise<unknown>;

	@Mobx.observable private internalItemName: string;
	@Mobx.observable private internalItemVersion: string;
	@Mobx.observable private intermediateState: LibraryStoreItemState;
	@Mobx.observable private storage: Map<string, any>;
	@Mobx.observable private update?: any;

	@Mobx.computed
	public get meta(): any {
		return this.storage.get(this.internalItemName);
	}

	@Mobx.computed
	public get hasUpdate(): boolean {
		return typeof this.update !== 'undefined';
	}

	@Mobx.computed
	public get itemName(): string {
		if (this.meta) {
			return typeof this.meta.name !== 'undefined' ? this.meta.name : this.internalItemName;
		}

		return this.internalItemName;
	}

	@Mobx.computed
	public get itemVersion(): string {
		if (this.meta) {
			return typeof this.meta.version !== 'undefined'
				? this.meta.version
				: this.internalItemVersion;
		}

		return this.internalItemVersion;
	}

	@Mobx.computed
	public get updateVersion(): string | undefined {
		return this.update ? this.update.version : undefined;
	}

	@Mobx.computed
	public get fetched(): boolean {
		if (!this.meta) {
			return false;
		}

		return this.meta.version === this.version && this.meta.name === this.packageName;
	}

	@Mobx.computed
	public get hasLibrary(): boolean {
		return typeof this.library !== 'undefined';
	}

	@Mobx.computed
	public get state(): LibraryStoreItemState {
		if (!this.library) {
			return this.intermediateState;
		}

		if (this.hasUpdate) {
			return LibraryStoreItemState.NeedsUpdate;
		}

		switch (this.library.getState()) {
			case T.PatternLibraryState.Connecting:
				return LibraryStoreItemState.Installing;
			default:
				return LibraryStoreItemState.Installed;
		}
	}

	@Mobx.computed
	public get color(): string | undefined {
		const alva = this.meta ? this.meta.alva || {} : {};
		return this.library ? this.library.getColor() : alva.color;
	}

	@Mobx.computed
	public get image(): string | undefined {
		const alva = this.meta ? this.meta.alva || {} : {};
		return this.library ? this.library.getImage() : alva.image;
	}

	@Mobx.computed
	public get name(): string | undefined {
		const meta = this.meta ? this.meta : {};
		return this.library
			? this.library.getName()
			: meta
				? meta.name || this.itemName
				: this.itemName;
	}

	@Mobx.computed
	public get displayName(): string | undefined {
		const alva = this.meta ? this.meta.alva || {} : {};
		return this.library
			? this.library.getDisplayName()
			: alva
				? alva.name || this.name
				: this.name;
	}

	@Mobx.computed
	public get description(): string | undefined {
		const meta = this.meta ? this.meta : {};
		return this.library ? this.library.getDescription() : meta.description;
	}

	@Mobx.computed
	public get version(): string {
		const meta = this.meta ? this.meta : {};

		return this.library
			? this.library.getVersion()
			: meta
				? meta.version || this.itemVersion
				: this.itemVersion;
	}

	@Mobx.computed
	public get homepage(): string | undefined {
		const meta = this.meta ? this.meta : {};
		return this.library ? this.library.getHomepage() : meta.homepage;
	}

	@Mobx.computed
	public get installType(): T.PatternLibraryInstallType | undefined {
		if (this.type === LibraryStoreItemType.Recommended) {
			return T.PatternLibraryInstallType.Remote;
		}

		return this.library ? this.library.getInstallType() : T.PatternLibraryInstallType.Remote;
	}

	@Mobx.computed
	public get packageName(): string | undefined {
		return this.library ? this.library.getPackageName() : this.itemName;
	}

	@Mobx.computed
	public get origin(): string | undefined {
		return this.library ? this.library.getOrigin() : T.PatternLibraryOrigin.Unknown;
	}

	@Mobx.computed
	public get updateable(): boolean {
		return (
			this.hasLibrary &&
			this.installType === PatternLibraryInstallType.Remote &&
			this.origin === PatternLibraryOrigin.UserProvided
		);
	}

	@Mobx.computed
	public get usesRemoteMeta(): boolean {
		if (this.library && this.library.builtin) {
			return false;
		}

		if (this.type === LibraryStoreItemType.Recommended) {
			return true;
		}

		return this.installType === PatternLibraryInstallType.Remote;
	}

	public constructor(init: LibraryStoreItemInit) {
		this.id = init.id || uuid.v4();
		this.library = init.library;
		this.type = init.type;
		this.internalItemName = init.name;
		this.internalItemVersion = init.version;

		this.intermediateState =
			this.type === LibraryStoreItemType.Recommended
				? LibraryStoreItemState.Listed
				: LibraryStoreItemState.Unknown;

		this.storage = init.meta || new Map();

		Mobx.autorun(async () => {
			if (!this.fetched) {
				this.fetching = this.fetch();
				const meta = await this.fetching;
				this.storage.set(init.name, meta);
			}

			this.checkForUpdate();
		});
	}

	public static fromRecommendation(
		name: { name: string; version: string },
		ctx: {
			meta: Map<string, any>;
			getLibraryByPackageName(name: string): PatternLibrary | undefined;
		}
	): LibraryStoreItem {
		return new LibraryStoreItem({
			library: ctx.getLibraryByPackageName(name.name),
			type: LibraryStoreItemType.Recommended,
			name: name.name,
			version: name.version,
			meta: ctx.meta
		});
	}

	public static fromLibrary(library: PatternLibrary): LibraryStoreItem {
		const type =
			library.getInstallType() === T.PatternLibraryInstallType.Local
				? LibraryStoreItemType.Local
				: LibraryStoreItemType.Remote;

		return new LibraryStoreItem({
			library,
			type,
			name: library.getName(),
			version: library.getVersion()
		});
	}

	@Mobx.action
	public fetch = Mobx.flow<void>(function*(this: LibraryStoreItem): IterableIterator<any> {
		if (!this.usesRemoteMeta) {
			return;
		}

		if (this.fetching) {
			return this.fetching;
		}

		const response = yield (fetch(
			`https://registry.npmjs.cf/${this.packageName}`
		) as unknown) as Response;

		if (!response.ok) {
			return;
		}

		const data = yield response.json();
		const version = data['dist-tags'][this.version!] || this.version!;
		const meta = data['versions'][version];

		if (!meta) {
			return;
		}

		this.fetching = undefined;
		return meta;
	});

	@Mobx.action
	public abort() {
		this.intermediateState =
			this.type === LibraryStoreItemType.Recommended
				? LibraryStoreItemState.Listed
				: LibraryStoreItemState.Unknown;

		if (this.library) {
			this.library.setState(PatternLibraryState.Connected);
		}
	}

	@Mobx.action
	public async connect(
		sender: {
			send: T.Sender<M.Message>['send'];
			transaction: T.Sender<M.Message>['transaction'];
		},
		data: { project: Project; npmId?: string; installType?: PatternLibraryInstallType }
	): Promise<void> {
		if (this.state === LibraryStoreItemState.Installing) {
			return;
		}

		if (
			this.state === LibraryStoreItemState.Listed &&
			this.installType === T.PatternLibraryInstallType.Remote
		) {
			this.intermediateState = LibraryStoreItemState.Installing;

			await sender.transaction(
				{
					id: uuid.v4(),
					type: M.MessageType.ConnectNpmPatternLibraryRequest,
					payload: {
						npmId: data.npmId || this.packageName!,
						projectId: data.project.getId()
					}
				},
				{ type: M.MessageType.ConnectPatternLibraryResponse }
			);
		}

		if (!this.library) {
			return;
		}

		if (this.installType === T.PatternLibraryInstallType.Local) {
			this.intermediateState = LibraryStoreItemState.Installing;
			this.library.setState(T.PatternLibraryState.Connecting);
			this.update = undefined;

			await sender.transaction(
				{
					id: uuid.v4(),
					type: M.MessageType.UpdatePatternLibraryRequest,
					payload: {
						projectId: data.project.getId(),
						libId: this.library.getId(),
						installType: data.installType || this.installType!
					}
				},
				{ type: M.MessageType.UpdatePatternLibraryResponse }
			);
		}

		if (this.installType === T.PatternLibraryInstallType.Remote) {
			this.intermediateState = LibraryStoreItemState.Installing;
			this.library.setState(T.PatternLibraryState.Connecting);
			this.update = undefined;

			await sender.transaction(
				{
					id: uuid.v4(),
					type: M.MessageType.UpdateNpmPatternLibraryRequest,
					payload: {
						projectId: data.project.getId(),
						libId: this.library.getId(),
						npmId: data.npmId,
						installType: data.installType || this.installType!
					}
				},
				{ type: M.MessageType.UpdatePatternLibraryResponse }
			);
		}
	}

	@Mobx.action
	public checkForUpdate = Mobx.flow<void>(function*(
		this: LibraryStoreItem
	): IterableIterator<any> {
		if (!this.updateable) {
			return;
		}

		const response = yield (fetch(
			`https://registry.npmjs.cf/${this.packageName}`
		) as unknown) as Response;

		if (!response.ok) {
			return;
		}

		const data = yield response.json();
		const latestVersion = (data['dist-tags'] || {}).latest;
		const latestData = data.versions[latestVersion];

		if (!latestData) {
			return;
		}

		if (semver.gt(latestVersion, this.version!)) {
			this.update = latestData;
		}
	});
}
