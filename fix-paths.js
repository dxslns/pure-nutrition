// fix-paths.js
const fs = require('fs');
const path = require('path');

function fixHtmlFiles(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    files.forEach(file => {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            // Рекурсивно обходим подпапки
            fixHtmlFiles(fullPath);
        } else if (file.name.endsWith('.html')) {
            // Читаем файл
            let content = fs.readFileSync(fullPath, 'utf8');

            // Заменяем href="filename.html" на href="./filename.html"
            content = content.replace(/href="([^"\/][^"]*\.html)"/g, 'href="./$1"');

            // Заменяем window.location.href='filename.html'
            content = content.replace(/window\.location\.href='([^'\/][^']*\.html)'/g, "window.location.href='./$1'");

            // Заменяем onclick="window.location.href='filename.html'"
            content = content.replace(/onclick="window\.location\.href='([^'\/][^']*\.html)'"/g, 'onclick="window.location.href=\'./$1\'"');

            // Сохраняем
            fs.writeFileSync(fullPath, content);
            console.log(`Fixed: ${fullPath}`);
        }
    });
}

// Запускаем для папки frontend
const frontendDir = path.join(__dirname, 'frontend');
fixHtmlFiles(frontendDir);
console.log('Done!');