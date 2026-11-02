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

export interface ContainerLike {
  createIfNotExists(): Promise<unknown>;
  getBlockBlobClient(name: string): BlobLike;
}

const UPLOAD_BUFFER_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode;

export class AzureBlobStorage implements FileStorage, OnModuleInit {
  readonly kind = 'azure';
  private readonly logger = new Logger(AzureBlobStorage.name);
  private ready: Promise<unknown> | undefined;

  constructor(private readonly container: ContainerLike) {}

  static fromConnectionString(connectionString: string, containerName: string) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    return new AzureBlobStorage(service.getContainerClient(containerName));
  }

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
    // best effort, an orphaned blob is fine
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
