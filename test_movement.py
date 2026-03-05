from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        def handle_request(request):
            if "search" in request.url:
                print(f"Request: {request.url}")

        page.on("request", handle_request)
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

        print("Navigating to page...")
        page.goto("http://localhost:8080")

        time.sleep(3)

        print("Zooming in to trigger auto search...")
        page.evaluate("""
            const el = document.querySelector('#map');
            if (el && el._leaflet_map) {
               window.myMap = el._leaflet_map;
               window.myMap.setZoom(16, {animate: false});
            }
        """)

        time.sleep(3)
        print("Moving down (simulate part of L-shape)...")
        page.evaluate("""
            if (window.myMap) {
                window.myMap.panBy([0, 500], {animate: false});
            }
        """)
        time.sleep(3)

        print("Moving right (completes L-shape)...")
        page.evaluate("""
            if (window.myMap) {
                window.myMap.panBy([500, 0], {animate: false});
            }
        """)
        time.sleep(3)

        print("Moving diagonally back into the hole created by the L-shape...")
        page.evaluate("""
            if (window.myMap) {
                window.myMap.panBy([-400, -400], {animate: false});
            }
        """)
        time.sleep(3)

        print("Closing browser.")
        browser.close()

if __name__ == "__main__":
    run()
