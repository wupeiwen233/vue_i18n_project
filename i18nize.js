const fs = require('fs');
const path = require('path');
const glob = require('glob').glob;
const crypto = require('crypto');
const { parse } = require('@vue/compiler-sfc');
const htmlparser2 = require('htmlparser2');

const sourceDir = path.join(__dirname, 'source/src');
const outputDir = path.join(__dirname, 'output/src');

// 清空并准备输出目录
if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

// 翻译数据
const translations = {
    zh: {},
    en: {}
};

function generateKey(text) {
    return `i18n_${crypto.createHash('md5').update(text).digest('hex').substring(0, 8)}`;
}

function containsChinese(text) {
    return /[\u4e00-\u9fa5]/.test(text);  // 检测是否包含中文
}

function localizeText(text) {
    const trimmedText = text.trim();
    if (!trimmedText || !containsChinese(trimmedText)) {
        return text; // 忽略非中文文本
    }
    const key = generateKey(trimmedText);
    translations.zh[key] = trimmedText;
    translations.en[key] = trimmedText;
    return `$t('${key}')`;
}

// 处理插值表达式中的中文文本，保留逻辑运算符
function processInterpolationText(text) {
    return text.replace(/('([^']*[\u4e00-\u9fa5]+[^']*)'|`([^`]*[\u4e00-\u9fa5]+[^`]*)`)/g, (match, p1, chineseText1, chineseText2) => {
        const chineseText = chineseText1 || chineseText2;
        const key = generateKey(chineseText);
        translations.zh[key] = chineseText;
        translations.en[key] = chineseText;
        return `$t('${key}')`;
    });
}

function processAttributes(attrs) {
    // 处理标签属性中的中文内容，并确保动态绑定属性（:title、:placeholder）
    return attrs.replace(/(\s*)(:)?(title|placeholder)="([^"]*[\u4e00-\u9fa5]+[^"]*)"/g, (match, whitespace, hasColon, attr, value) => {
        const key = generateKey(value);
        translations.zh[key] = value;
        translations.en[key] = value;
        // 如果属性前面已经有 `:`, 就不用再加 `:`
        return `${whitespace}${hasColon || ':'}${attr}="$t('${key}')"`;  
    });
}

// 解析 HTML 并处理嵌套，同时保留条件表达式和逻辑运算符
function processTemplateContent(content) {
    const dom = htmlparser2.parseDOM(content, { xmlMode: true }); // 启用 xmlMode 保持属性名的原始大小写
    const traverseDom = (nodes) => {
        let output = '';
        nodes.forEach(node => {
            if (node.type === 'tag') {
                // 处理标签
                output += `<${node.name}${Object.keys(node.attribs).map(attr => ` ${attr}="${node.attribs[attr]}"`).join('')}>`;
                output += traverseDom(node.children || []);
                output += `</${node.name}>`;
            } else if (node.type === 'text') {
                // 处理文本
                const text = node.data.trim();
                if (text.includes('{{')) {
                    // 处理插值表达式，保留逻辑表达式
                    output += text.replace(/{{(.*?)}}/g, (match, p1) => `{{ ${processInterpolationText(p1)} }}`);
                } else if (containsChinese(text)) {
                    // 处理纯中文文本
                    output += `{{ ${localizeText(text)} }}`;
                } else {
                    output += node.data;
                }
            }
        });
        return output;
    };
    return traverseDom(dom);
}

console.log(`Searching for Vue files in: ${sourceDir}`);
const files = glob.sync(`${sourceDir}/**/*.*`);  // 查找所有文件

if (files.length === 0) {
    console.log('No files found in the source directory.');
} else {
    files.forEach(file => {
        const ext = path.extname(file);

        if (ext === '.vue') {
            const content = fs.readFileSync(file, 'utf8');

            // 使用 Vue SFC 编译器解析 .vue 文件
            const { descriptor } = parse(content);
            let localizedTemplate = '';

            // 处理模板部分
            if (descriptor.template) {
                let templateContent = descriptor.template.content;
                // 处理模板中的属性（如 placeholder 和 title）
                templateContent = processAttributes(templateContent);
                // 处理模板内容
                const processedContent = processTemplateContent(templateContent);
                localizedTemplate = `<template>${processedContent}</template>`;
            }

            // 保留 script 部分
            const scriptPart = descriptor.script ? `<script>${descriptor.script.content}</script>` : '';

            // 保留 style 部分
            const stylesPart = descriptor.styles
                ? descriptor.styles.map(style => `<style${style.scoped ? ' scoped' : ''}>${style.content}</style>`).join('\n')
                : '';

            // 合并最终结果
            const finalOutput = `${localizedTemplate}\n${scriptPart}\n${stylesPart}`;

            // 输出处理后的文件
            const relativePath = path.relative(sourceDir, file);
            const outputFile = path.join(outputDir, relativePath);
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, finalOutput, 'utf8');
        } else {
            // 非 .vue 文件原样拷贝
            const relativePath = path.relative(sourceDir, file);
            const outputFile = path.join(outputDir, relativePath);
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.copyFileSync(file, outputFile);
        }
    });

    // 写入翻译文件
    fs.mkdirSync(path.join(outputDir, 'lang'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'lang', 'zh.js'), `export default ${JSON.stringify(translations.zh, null, 2)};`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'lang', 'en.js'), `export default ${JSON.stringify(translations.en, null, 2)};`, 'utf8');
}

console.log("国际化处理脚本执行完毕!");
