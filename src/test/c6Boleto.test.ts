import { describe, it, expect } from 'vitest';
import { buildBankSlipPayload, mapC6Response, newExternalReferenceId, pem, todayBR, validateBoletoInput } from '../../api/c6';

const payer = {
  name: 'EMPRESA TESTE LTDA',
  tax_id: '11.222.333/0001-81',
  email: 'financeiro@teste.com.br',
  address: { address: 'Rua das Flores, 100', neighborhood: 'Centro', city: 'Santos', state: 'sp', zip_code: '11010-000' },
};

describe('C6 boleto — validação e payload', () => {
  it('external_reference_id tem 26 caracteres A-Z0-9 e não repete', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newExternalReferenceId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Z0-9]{26}$/);
  });

  it('aceita dados válidos e normaliza CNPJ, CEP e UF', () => {
    const r = validateBoletoInput({ amount: '199.9', due_date: '2026-12-10', description: 'Assinatura Aura — dez/2026', payer }, '2026-11-13');
    expect(r.errors).toEqual([]);
    expect(r.amount).toBe(199.9);
    expect(r.payer.tax_id).toBe('11222333000181');
    expect(r.payer.address.zip_code).toBe('11010000');
    expect(r.payer.address.state).toBe('SP');
  });

  it('recusa vencimento no passado, valor inválido e nome acima do limite do C6', () => {
    const r = validateBoletoInput(
      { amount: 0, due_date: '2026-11-12', description: '', payer: { ...payer, name: 'X'.repeat(41), tax_id: '123' } },
      '2026-11-13',
    );
    expect(r.errors.join(' ')).toMatch(/Valor/);
    expect(r.errors.join(' ')).toMatch(/Vencimento/);
    expect(r.errors.join(' ')).toMatch(/Descrição/);
    expect(r.errors.join(' ')).toMatch(/Nome/);
    expect(r.errors.join(' ')).toMatch(/CPF\/CNPJ/);
  });

  it('vencimento hoje é permitido', () => {
    const r = validateBoletoInput({ amount: 10, due_date: '2026-11-13', description: 'x', payer }, '2026-11-13');
    expect(r.errors).toEqual([]);
  });

  it('payload usa a carteira certa por ambiente e a chave Pix EVP', () => {
    const v = validateBoletoInput({ amount: 150, due_date: '2026-12-10', description: 'Assinatura', payer }, '2026-11-13');
    const row = { external_reference_id: 'A'.repeat(26), description: v.description, amount: v.amount, due_date: v.due_date, payer: v.payer };
    const sandbox = buildBankSlipPayload(row, 'sandbox', 'chave-evp');
    const prod = buildBankSlipPayload(row, 'production', 'chave-evp');
    expect(sandbox.payment_method.bank_slip.billing_scheme).toBe('21');
    expect(prod.payment_method.bank_slip.billing_scheme).toBe('15');
    expect(sandbox.payment_method.pix).toEqual({ type: 'EVP', key: 'chave-evp' });
    expect(sandbox.payer.tax_id).toBe('11222333000181');
    expect(sandbox.payer_notification).toBeUndefined();
  });

  it('só notifica o pagador por e-mail quando pedido e há e-mail', () => {
    const row = { external_reference_id: 'B'.repeat(26), description: 'x', amount: 10, due_date: '2026-12-10', payer, notify_email: true };
    const body = buildBankSlipPayload(row, 'sandbox', 'k');
    expect(body.payer_notification).toHaveLength(3);
    expect(body.payer_notification[0]).toEqual({ channel: 'EMAIL', destination: 'financeiro@teste.com.br', notification_date: 'ISSUE_DATE' });
    const semEmail = buildBankSlipPayload({ ...row, payer: { ...payer, email: null } }, 'sandbox', 'k');
    expect(semEmail.payer_notification).toBeUndefined();
  });

  it('limita instruções a 4 linhas de 80 caracteres', () => {
    const row = {
      external_reference_id: 'C'.repeat(26), description: 'x', amount: 10, due_date: '2026-12-10', payer,
      instructions: ['a'.repeat(100), 'b', 'c', 'd', 'e'],
    };
    const inst = buildBankSlipPayload(row, 'sandbox', 'k').payment_method.bank_slip.instructions;
    expect(inst).toHaveLength(4);
    expect(inst[0]).toHaveLength(80);
  });

  it('traduz resposta do C6: pago, aguardando liquidação, emissão', () => {
    expect(mapC6Response({ status: 'PAID', payments: [{ amount: '150.00', payment_date: '2026-12-09', payment_type: 'PIX' }] })).toMatchObject({
      status: 'paid', paid_amount: 150, payment_type: 'PIX',
    });
    expect(mapC6Response({ status: 'WAITING_CONFIRMATION' }).status).toBe('waiting_confirmation');
    expect(mapC6Response({ status: 'CANCELED' }).status).toBe('canceled');
    const emitida = mapC6Response({
      id: 'abc',
      payment_method: { bank_slip: { digitable_line: '1234', bar_code: '999', our_number: '7' }, pix: { qr_code: 'qr' } },
    });
    expect(emitida).toMatchObject({ status: 'created', c6_id: 'abc', digitable_line: '1234', bar_code: '999', our_number: '7', pix_qr_code: 'qr' });
  });

  it('todayBR devolve data AAAA-MM-DD no fuso de Brasília', () => {
    expect(todayBR(new Date('2026-11-13T02:00:00Z'))).toBe('2026-11-12');
    expect(todayBR(new Date('2026-11-13T12:00:00Z'))).toBe('2026-11-13');
  });
});

describe('pem (leitura do certificado/chave vindos da Vercel)', () => {
  const body = 'QUJD'.repeat(40); // 160 caracteres base64 (conteúdo fictício)
  const lines = body.match(/.{1,64}/g)!.join('\n');
  const limpo = `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;

  it('devolve o PEM normal', () => expect(pem(limpo)).toBe(limpo));
  it('tira aspas e texto antes/depois', () => expect(pem(`"Bag Attributes\n${limpo.trim()}\n"`)).toBe(limpo));
  it('aceita CRLF', () => expect(pem(limpo.replace(/\n/g, '\r\n'))).toBe(limpo));
  it('aceita \n literal', () => expect(pem(limpo.trim().replace(/\n/g, '\n'))).toBe(limpo));
  it('aceita linhas coladas por espaço', () => expect(pem(limpo.trim().replace(/\n/g, ' '))).toBe(limpo));
  it('aceita o PEM inteiro em base64', () => expect(pem(Buffer.from(limpo).toString('base64'))).toBe(limpo));
  it('aceita chave privada', () => {
    const k = `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
    expect(pem(k.trim())).toBe(k);
  });
  it('rejeita vazio e texto qualquer', () => {
    expect(pem(undefined)).toBeNull();
    expect(pem('   ')).toBeNull();
    expect(pem('meu-certificado.crt')).toBeNull();
  });
});
