import { Logger, type OnModuleInit } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import { Readable } from 'node:stream';
import {
  ByteCounter,
  storedNameOf,
  toStream,
  UPLOAD_PREFIX,
  type FileStorage,
  type OpenedFile,
  type PutInput,
  type StoredFile,
} from './file-storage.js';

/** The part of a block blob client this driver uses; the real `BlockBlobClient` fits, so does a spec's fake. */
export interface BlobLike {
  uploadStream(
    stream: Readable,
    bufferSize?: number,
    maxConcurrency?: number,
    options?: { blobHTTPHeaders?: { blobContentType?: string } },
  ): Promise<unknown>;
  deleteIfExists(): Promise<unknown>;
  download(): Promise<{ readableStreamBody?: NodeJS.ReadableStream; contentLength?: number }>;
}

/** The part of `ContainerClient` this driver uses. */
export interface ContainerLike {
  createIfNotExists(): Promise<unknown>;
  getBlockBlobClient(name: string): BlobLike;
}

const UPLOAD_BUFFER_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode;

/**
 * Files as blobs in a private container. Nothing is public: the API reads a blob and streams it under
 * /uploads/<name> with the same hardening headers as local files, so urls stored in the database stay valid
 * for ever (no expiring SAS tokens) and the browser never talks to the storage account.
 */
export class AzureBlobStorage implements FileStorage, OnModuleInit {
  readonly kind = 'azure';
  private readonly logger = new Logger(AzureBlobStorage.name);
  private ready: Promise<unknown> | undefined;

  constructor(private readonly container: ContainerLike) {}

  static fromConnectionString(connectionString: string, containerName: string) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    return new AzureBlobStorage(service.getContainerClient(containerName));
  }

  /** Creates the container on first start; if Azure is unreachable now, the first upload tries again. */
  async onModuleInit() {
    await this.ensureContainer().catch((error: unknown) =>
      this.logger.warn(`Cannot prepare the blob container yet: ${String(error)}`),
    );
  }

  async put({ name, data, contentType }: PutInput): Promise<StoredFile> {
    await this.ensureContainer();
    const counter = new ByteCounter();
    const source = toStream(data);
    source.on('error', (error) => counter.destroy(error)); // pipe() does not forward errors
    await this.container
      .getBlockBlobClient(name)
      .uploadStream(source.pipe(counter), UPLOAD_BUFFER_BYTES, UPLOAD_CONCURRENCY, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    return { name, url: this.urlFor(name), size: counter.bytes };
  }

  async delete(urlOrName: string) {
    const name = storedNameOf(urlOrName);
    if (!name) return;
    // an orphaned blob is cheaper than failing the request that already removed the database row
    await this.container
      .getBlockBlobClient(name)
      .deleteIfExists()
      .catch((error: unknown) =>
        this.logger.warn(`Could not delete blob ${name}: ${String(error)}`),
      );
  }

  async open(name: string): Promise<OpenedFile | null> {
    try {
      const { readableStreamBody, contentLength } = await this.container
        .getBlockBlobClient(name)
        .download();
      if (!readableStreamBody) return null;
      const stream =
        readableStreamBody instanceof Readable
          ? readableStreamBody
          : new Readable().wrap(readableStreamBody);
      return { stream, size: contentLength };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  urlFor(name: string) {
    return `${UPLOAD_PREFIX}${name}`;
  }

  private ensureContainer() {
    this.ready ??= this.container.createIfNotExists().catch((error: unknown) => {
      this.ready = undefined; // do not cache a failure
      throw error;
    });
    return this.ready;
  }
}
