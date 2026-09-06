import { scryptSync, timingSafeEqual } from 'node:crypto';

type Account = {
  email: string;
  name: string;
  salt: string;
  hash: string;
};

const accounts: Account[] = [
  {
    email: 'kyani1278@gmail.com',
    name: 'Kyani',
    salt: 'f9314ba17b5c3f6f1c49c9c770c104b1',
    hash: '69a2e16cd59048f3a8b59ee40c9aa6f63a7db069db8c4983cb676a752d6330939f80cc877e33c3f0cb5251b29f4fd342d3fa2c52b97cca83f4e507b95e2d96c1',
  },
  {
    email: 'contrerasaaron447@gmail.com',
    name: 'Aaron Contreras',
    salt: 'd36679f6a6957a36d09564b264007b63',
    hash: '1e9854b7f85f6402ff1615d65e9fc2bfcd867982a5a511b4ded852ff7ff48098817f21bb79c7d5ca7c34942d6912fac434244cd2da7a82d69f3692f340eaf802',
  },
  {
    email: 'dylancontreras@gmail.com',
    name: 'Dylan Contreras',
    salt: '80b0d05c74220ed280e3be814c9d7288',
    hash: '1b31c1b4882edf95cf7b4434e73336b2174033f63d349bf2786d20fc49dbb407b80b2b57294a8b1aad92ac92c85e74a0348a004e16b19850fe985f858960b7d8',
  },
  {
    email: 'fabriciogutierrez@gmail.com',
    name: 'Fabricio Gutierrez',
    salt: '35ab709ebbfacef1c822068b68b29398',
    hash: '3740223d1924794d8bf69f8fb22b1660d6b099c692fda3884fb108a0d0a320d5e284ef8765c631403c1ef268e13c9d7216274a00625de38e5176ddcaf5125684',
  },
];

export function findAccount(email: string) {
  const normalized = email.trim().toLowerCase();
  return accounts.find((account) => account.email === normalized) ?? null;
}

export function authenticateAccount(email: string, password: string) {
  const account = findAccount(email);
  if (!account || password.length > 256) return null;
  const expected = Buffer.from(account.hash, 'hex');
  const received = scryptSync(password, account.salt, expected.length);
  return timingSafeEqual(expected, received) ? account : null;
}
