(() => {
  const body = document.body;
  if (!body || body.dataset.siteRoot === undefined) return;

  const root = body.dataset.siteRoot || './';
  const current = body.dataset.sitePage || '';
  const links = [
    ['home', '首页', ''],
    ['course', '八关课程', 'rl-lab/course.html'],
    ['simulator', '物理沙盒', 'simulator.html'],
  ];

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="site-nav">
      <a class="site-brand" href="${root}" aria-label="MicroDuck Tutor 首页">
        <span class="site-brand-mark">M</span>
        <span class="site-brand-text"><b>MicroDuck Tutor</b><small>用一只鸭子学会强化学习</small></span>
      </a>
      <nav class="site-links" aria-label="全站导航">
        ${links.map(([id, label, path]) => `<a href="${root}${path}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        <a class="site-source" href="https://github.com/weponusa/microduck-tutor">源码 ↗</a>
      </nav>
    </div>`;
  body.prepend(header);
})();
