const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Serve locally
    await page.goto('http://localhost:8080');

    // Wait for settings toggle button
    await page.waitForSelector('.nav-icon-btn[title="設定"]');
    await page.click('.nav-icon-btn[title="設定"]');
    await page.waitForTimeout(1000);

    // Find the select by looking for its previous sibling text
    await page.evaluate(() => {
        const selects = document.querySelectorAll('select');
        for (const select of selects) {
            if (select.previousElementSibling && select.previousElementSibling.textContent.includes('面積/單價單位')) {
                select.value = 'sqm';
                select.dispatchEvent(new Event('change'));
            }
        }
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshot_sqm_3.png' });

    await browser.close();
    console.log('Playwright test completed. Screenshots saved.');
})();
