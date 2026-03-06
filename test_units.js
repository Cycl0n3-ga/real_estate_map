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

    // Evaluate in page context to change the settings to sqm
    await page.evaluate(() => {
        const select = document.querySelector('select[v-model="markerSettings.areaUnit"]');
        if(select) {
            select.value = 'sqm';
            select.dispatchEvent(new Event('change'));
        }
    });

    // Take a screenshot with new sqm unit
    await page.waitForTimeout(2000); // Give it more time to render
    await page.screenshot({ path: 'screenshot_sqm_2.png' });

    await browser.close();
    console.log('Playwright test completed. Screenshots saved.');
})();
