import { test, expect, type Page } from '@playwright/test';

// Prérequis : API + interface servies par `wrangler dev` (npm run build && npm run dev:api), admin admin@test.local / Test12345.
const SHOTS = process.env.E2E_SHOTS ?? 'test-results/shots';
const RUN = Date.now().toString(36).slice(-5);

function ean(body12: string) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body12 + ((10 - (s % 10)) % 10);
}
const CODE = ean('619' + String(Date.now()).slice(-9));
const CODE2 = ean('620' + String(Date.now()).slice(-9));

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@test.local');
  await page.getByLabel('Mot de passe').fill('Test12345');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Ventes du jour')).toBeVisible();
}

async function apiPost(page: Page, url: string, body: unknown) {
  return page.evaluate(
    async ([u, b]) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ndc': '1' }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    },
    [url, body] as const,
  );
}

/** Simule un lecteur Honeywell USB HID : frappe très rapide puis suffixe (Entrée, Tab ou aucun). */
async function hidScan(page: Page, code: string, suffix: 'Enter' | 'Tab' | 'none' = 'Enter') {
  await page.keyboard.type(code, { delay: 4 });
  if (suffix !== 'none') await page.keyboard.press(suffix);
}

const qtyOf = (page: Page, name: string) => page.locator('div.border-b', { hasText: name }).locator('button[title="Modifier la quantité"]');

test.describe.serial('Nour de Commerce ERP', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  });

  test('connexion refusée puis réussie, tableau de bord simple', async () => {
    await page.goto('/');
    await page.getByLabel('Email').fill('admin@test.local');
    await page.getByLabel('Mot de passe').fill('mauvais-mdp');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Email ou mot de passe incorrect.')).toBeVisible();
    await login(page);
    await expect(page.getByText('Produits à commander').first()).toBeVisible();
    await expect(page.getByText('Developed by')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-dashboard-simple.png` });
    await page.getByRole('button', { name: 'Tableau de bord complet' }).click();
    await expect(page.getByText("Chiffre d'affaires du jour")).toBeVisible();
    await page.getByRole('button', { name: 'Vue simple' }).click();
    await expect(page.getByText('Ventes du jour')).toBeVisible();
  });

  test('fiche produit simple : un scan n’importe où remplit le code-barres', async () => {
    await page.goto('/produits/nouveau');
    await page.getByLabel('Nom du produit').fill('Gel douche E2E ' + RUN);
    await page.locator('h1').click(); // le focus n'est plus dans un champ
    await hidScan(page, CODE);
    await expect(page.getByText(CODE)).toBeVisible();
    await page.getByLabel('Prix de vente (TTC)').fill('4.998');
    await page.getByLabel("Quantité en stock aujourd'hui").fill('25');
    await page.screenshot({ path: `${SHOTS}/02-fiche-produit-simple.png` });
    await page.getByRole('button', { name: 'Enregistrer' }).last().click();
    await expect(page.getByText(/Produit créé/)).toBeVisible();
    // second produit pour les tests de suffixe
    const r = await apiPost(page, '/api/products', { name: 'Shampoing E2E ' + RUN, sale_price: 3000, barcodes: [{ barcode: CODE2 }], initial_stock: 10 });
    expect(r.status).toBe(200);
  });

  test('caisse : scan Entrée, scans répétés, code inconnu, encaissement', async () => {
    const cur = await page.evaluate(async () => (await fetch('/api/cash/current')).json());
    if (!cur.session) await apiPost(page, '/api/cash/open', { register_id: 'reg-1', opening_amount: 100000 });
    await page.goto('/pos');
    await expect(page.getByPlaceholder('Scanner ou rechercher un produit…')).toBeFocused();
    await hidScan(page, CODE);
    await expect(qtyOf(page, 'Gel douche E2E ' + RUN)).toHaveText('1');
    await page.waitForTimeout(400); // scan répété volontaire (après l'anti-doublon)
    await hidScan(page, CODE);
    await expect(qtyOf(page, 'Gel douche E2E ' + RUN)).toHaveText('2');
    await hidScan(page, '0000000000017');
    await expect(page.getByText(/Code inconnu/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-pos.png` });
    await page.keyboard.press('F9');
    await expect(page.getByText('Montant reçu du client')).toBeVisible();
    await page.getByRole('button', { name: /^20,000$/ }).click();
    await expect(page.getByText(/Monnaie à rendre/).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Vente validée')).toBeVisible();
    await expect(page.getByText('Monnaie à rendre')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-vente-validee.png` });
    await page.getByRole('button', { name: 'Nouvelle vente' }).click();
  });

  test('caisse : lecteur sans suffixe, suffixe Tab, scan après un clic ailleurs', async () => {
    await page.goto('/pos');
    await expect(page.getByPlaceholder('Scanner ou rechercher un produit…')).toBeFocused();
    // lecteur réglé sans touche de fin
    await hidScan(page, CODE2, 'none');
    await expect(qtyOf(page, 'Shampoing E2E ' + RUN)).toHaveText('1');
    // lecteur réglé avec Tab
    await page.waitForTimeout(400);
    await hidScan(page, CODE2, 'Tab');
    await expect(qtyOf(page, 'Shampoing E2E ' + RUN)).toHaveText('2');
    // clic sur le bouton + d'une ligne puis scan immédiat : le curseur revient dans le champ de scan
    await page.locator('div.border-b', { hasText: 'Shampoing E2E ' + RUN }).getByLabel('plus').click();
    await expect(qtyOf(page, 'Shampoing E2E ' + RUN)).toHaveText('3');
    await page.waitForTimeout(100);
    await hidScan(page, CODE);
    await expect(qtyOf(page, 'Gel douche E2E ' + RUN)).toHaveText('1');
    await expect(qtyOf(page, 'Shampoing E2E ' + RUN)).toHaveText('3');
    // vider pour ne pas laisser de panier
    await page.getByRole('button', { name: 'Vider' }).click();
    await page.getByRole('button', { name: 'Confirmer' }).click();
  });

  test('interface arabe (RTL) avec drapeau tunisien', async () => {
    await page.goto('/');
    await page.getByTitle('العربية').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('مبيعات اليوم')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-dashboard-ar.png` });
    await page.getByTitle('Français').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('page de test du scanner : diagnostic', async () => {
    await page.goto('/scanner');
    await page.getByPlaceholder('Cliquez ici puis scannez un code-barres avec le lecteur').click();
    await hidScan(page, '0012345678905');
    await expect(page.getByText('Lecture réussie').first()).toBeVisible();
    await expect(page.getByText(/reconnu à l'identique/)).toBeVisible();
    await expect(page.getByText(/touche Entrée envoyée/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-scanner.png` });
  });

  test('pages principales sans erreur (menu complet)', async () => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const p of ['/ventes', '/factures', '/produits', '/stock', '/stock/mouvements', '/inventaires', '/stock/lots', '/stock/alertes', '/fournisseurs', '/achats/commandes', '/achats/receptions', '/achats/factures', '/clients', '/creances', '/dettes', '/caisse', '/paiements', '/depenses', '/rentabilite', '/rapports', '/exports', '/documents', '/utilisateurs', '/roles', '/verification', '/audit', '/import', '/parametres', '/sauvegardes', '/devis', '/commandes', '/livraisons', '/retours', '/categories', '/codes-barres', '/profil']) {
      await page.goto(p);
      await expect(page.locator('main h1').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('version mobile, menu simplifié', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
    const m = await ctx.newPage();
    await m.goto('/');
    await expect(m.getByText('Ventes du jour')).toBeVisible();
    await m.screenshot({ path: `${SHOTS}/07-mobile.png` });
    await m.getByLabel('Menu').first().click();
    await expect(m.getByRole('link', { name: 'Vendre (caisse)' })).toBeVisible();
    await expect(m.getByRole('button', { name: 'Afficher tout le menu' })).toBeVisible();
    await m.screenshot({ path: `${SHOTS}/08-mobile-menu.png` });
    await ctx.close();
  });
});
