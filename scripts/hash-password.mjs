// Print an ADMIN_PASSWORD_HASH value:  node scripts/hash-password.mjs 'your password'
// (or pipe the password on stdin so it stays out of shell history).
import {hashPassword} from '../src/auth.mjs';

let password = process.argv[2];
if (!password && !process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs 'password'   (or: echo password | node scripts/hash-password.mjs)");
  process.exit(1);
}
console.log(hashPassword(password));
