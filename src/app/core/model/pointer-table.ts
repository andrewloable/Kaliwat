import { UUID } from './types';

export class PointerTable {
  private xrefToUuid = new Map<string, UUID>();
  private uuidToXref = new Map<UUID, string>();

  register(xref: string, uuid: UUID): void {
    this.xrefToUuid.set(xref, uuid);
    this.uuidToXref.set(uuid, xref);
  }

  getUuid(xref: string): UUID | undefined {
    return this.xrefToUuid.get(xref);
  }

  getXref(uuid: UUID): string | undefined {
    return this.uuidToXref.get(uuid);
  }

  allocate(prefix = 'I'): string {
    let n = this.xrefToUuid.size + 1;
    let xref: string;
    do {
      xref = `@${prefix}${n}@`;
      n++;
    } while (this.xrefToUuid.has(xref));
    return xref;
  }

  hasXref(xref: string): boolean {
    return this.xrefToUuid.has(xref);
  }

  hasUuid(uuid: UUID): boolean {
    return this.uuidToXref.has(uuid);
  }
}
