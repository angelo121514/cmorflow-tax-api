"""Independent XML/C14N verification of synthetic audit fixtures; never contacts SII."""
import base64
import hashlib
import json
import re
from pathlib import Path
import zipfile
from lxml import etree
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

root = Path(__file__).resolve().parents[1]
out = root / 'coverage/audit-2026-09-19'
official = out / 'official'
official.mkdir(exist_ok=True)
with zipfile.ZipFile(out / 'schema_dte.zip') as archive:
    # Only schema basenames: no untrusted archive paths are extracted.
    for name in archive.namelist():
        if name.lower().endswith('.xsd'):
            (official / Path(name).name).write_bytes(archive.read(name))
ns = {'ds': 'http://www.w3.org/2000/09/xmldsig#'}
results = {}
for name in ['seed.xml', 'dte-33.xml', 'dte-39.xml', 'envelope-33.xml', 'envelope-39.xml']:
    try:
        doc = etree.parse(str(out / name))
    except etree.XMLSyntaxError as error:
        results[name] = {'wellFormed': False, 'error': str(error)}
        continue
    item = {'wellFormed': True, 'signatures': []}
    raw_infos = re.findall(r'<SignedInfo>[\s\S]*?</SignedInfo>', (out / name).read_bytes().decode('latin1'))
    for signature_index, signature in enumerate(doc.xpath('//ds:Signature', namespaces=ns)):
        info = signature.find('ds:SignedInfo', ns)
        canonical = etree.tostring(info, method='c14n')
        modulus = int.from_bytes(base64.b64decode(signature.findtext('ds:KeyInfo/ds:KeyValue/ds:RSAKeyValue/ds:Modulus', namespaces=ns)), 'big')
        exponent = int.from_bytes(base64.b64decode(signature.findtext('ds:KeyInfo/ds:KeyValue/ds:RSAKeyValue/ds:Exponent', namespaces=ns)), 'big')
        key = rsa.RSAPublicNumbers(exponent, modulus).public_key()
        valid = True
        try:
            key.verify(base64.b64decode(signature.findtext('ds:SignatureValue', namespaces=ns)), canonical, padding.PKCS1v15(), hashes.SHA1())
        except Exception:
            valid = False
        raw_valid = True
        try:
            key.verify(base64.b64decode(signature.findtext('ds:SignatureValue', namespaces=ns)), raw_infos[signature_index].encode('utf-8'), padding.PKCS1v15(), hashes.SHA1())
        except Exception:
            raw_valid = False
        reference = info.find('ds:Reference', ns)
        target = doc.xpath('//*[@ID=$target]', target=reference.get('URI')[1:])[0]
        # Enveloped transform removes this signature, not other signatures.
        parent = signature.getparent()
        index = parent.index(signature)
        tail = signature.tail
        in_target = target is parent or target in parent.iterancestors()
        if in_target:
            previous = signature.getprevious()
            if previous is None:
                parent.text = (parent.text or '') + (tail or '')
            else:
                previous.tail = (previous.tail or '') + (tail or '')
            parent.remove(signature)
        target_digest = base64.b64encode(hashlib.sha1(etree.tostring(target, method='c14n')).digest()).decode()
        item['signatures'].append({'target': reference.get('URI'), 'rsaValidOnRawNonstandardBytes': raw_valid, 'rsaValidAfterC14N': valid, 'digestValidAfterC14N': target_digest == reference.findtext('ds:DigestValue', namespaces=ns)})
        if in_target:
            # Restore original parsed XML for any subsequent checks.
            doc = etree.parse(str(out / name))
    results[name] = item

for label, schema_path, file in [
    ('officialInvoice', official / 'EnvioDTE_v10.xsd', 'envelope-33.xml'),
    ('bundledInvoice', root / 'src/infrastructure/framework/sii/xsd/EnvioDTE_v10.xsd', 'envelope-33.xml'),
    ('bundledBoletaUnsignedEnvelope', root / 'src/infrastructure/framework/sii/xsd/EnvioBOLETA_v11.xsd', 'unsigned-envelope-39.xml'),
]:
    try:
        schema = etree.XMLSchema(etree.parse(str(schema_path)))
        doc = etree.parse(str(out / file))
        valid = schema.validate(doc)
        results[label] = {'valid': valid, 'errors': [str(e) for e in schema.error_log][:12]}
    except Exception as e:
        results[label] = {'error': str(e)}
print(json.dumps(results, indent=2, ensure_ascii=False))
(out / 'xml-results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
