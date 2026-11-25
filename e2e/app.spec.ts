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

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@test.local');
  await page.getByLabel('Mot de passe').fill('Test12345');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
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

/** Simule un lecteur Honeywell USB HID : frappe très rapide puis suffixe Entrée. */
async function hidScan(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 4 });
  await page.keyboard.press('Enter');
}

test.describe.serial('Nour de Commerce ERP', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  });

  test('connexion refusée puis réussie, tableau de bord', async () => {
    await page.goto('/');
    await page.getByLabel('Email').fill('admin@test.local');
    await page.getByLabel('Mot de passe').fill('mauvais-mdp');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Email ou mot de passe incorrect.')).toBeVisible();
    await login(page);
    await expect(page.getByText("Chiffre d'affaires du jour")).toBeVisible();
    await expect(page.getByText('Developed by')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: false });
  });

  test('création de produit avec code-barres scanné', async () => {
    await page.goto('/produits/nouveau');
    await page.getByLabel('Désignation').fill('Gel douche E2E ' + RUN);
    await page.getByRole('button', { name: 'Scanner le code-barres' }).click();
    await hidScan(page, CODE);
    await expect(page.locator(`input[value="${CODE}"]`)).toBeVisible();
    await page.getByLabel('Prix particulier HT').fill('4.200');
    await page.getByLabel('Stock initial').fill('25');
    await page.screenshot({ path: `${SHOTS}/02-fiche-produit.png` });
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await expect(page.getByText(/Produit créé/)).toBeVisible();
  });

  test('point de vente : scan HID, scans répétés, encaissement', async () => {
    const cur = await page.evaluate(async () => (await fetch('/api/cash/current')).json());
    if (!cur.session) await apiPost(page, '/api/cash/open', { register_id: 'reg-1', opening_amount: 100000 });
    await page.goto('/pos');
    await expect(page.getByPlaceholder('Scanner ou rechercher un produit…')).toBeFocused();
    await hidScan(page, CODE);
    await expect(page.getByText('Gel douche E2E ' + RUN).last()).toBeVisible();
    // scan répété intentionnel (après le délai anti-doublon) → quantité 2
    await page.waitForTimeout(400);
    await hidScan(page, CODE);
    await expect(page.locator('input[type="number"][value="2"]')).toBeVisible();
    // code inconnu
    await hidScan(page, '0000000000017');
    await expect(page.getByText(/Code inconnu/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-pos.png` });
    await page.keyboard.press('F9');
    await expect(page.getByText('Montant reçu')).toBeVisible();
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect(page.getByText('Vente validée')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-vente-validee.png` });
    await page.getByRole('button', { name: 'Nouvelle vente' }).click();
  });

  test('interface arabe (RTL) avec drapeau tunisien', async () => {
    await page.goto('/');
    await page.getByTitle('العربية').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'لوحة القيادة' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-dashboard-ar.png` });
    await page.getByTitle('Français').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('page de test du scanner', async () => {
    await page.goto('/scanner');
    await page.getByPlaceholder('Cliquez ici puis scannez un code-barres avec le lecteur').click();
    await hidScan(page, CODE);
    await expect(page.getByText('Lecture réussie').first()).toBeVisible();
    await expect(page.getByText('EAN-13').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-scanner.png` });
  });

  test('pages principales sans erreur', async () => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const p of ['/ventes', '/factures', '/produits', '/stock', '/stock/mouvements', '/inventaires', '/stock/lots', '/stock/alertes', '/fournisseurs', '/achats/commandes', '/achats/receptions', '/achats/factures', '/clients', '/creances', '/dettes', '/caisse', '/paiements', '/depenses', '/rentabilite', '/rapports', '/exports', '/documents', '/utilisateurs', '/roles', '/verification', '/audit', '/import', '/parametres', '/sauvegardes', '/devis', '/commandes', '/livraisons', '/retours', '/categories', '/codes-barres', '/profil']) {
      await page.goto(p);
      await expect(page.locator('main h1').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('version mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
    const m = await ctx.newPage();
    await m.goto('/');
    await expect(m.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
    await m.screenshot({ path: `${SHOTS}/07-mobile.png` });
    await m.getByLabel('Menu').first().click();
    await expect(m.getByRole('link', { name: 'Point de vente POS' })).toBeVisible();
    await m.screenshot({ path: `${SHOTS}/08-mobile-menu.png` });
    await ctx.close();
  });
});
