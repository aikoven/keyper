import gulp from 'gulp';
import gutil from 'gulp-util';
import mocha from 'gulp-mocha';
import ts from 'gulp-typescript';
import babel from 'gulp-babel';
import lazypipe from 'lazypipe';
import typedoc from 'gulp-typedoc';
import del from 'del';
import tsconfig from 'tsconfig-glob';
import 'babel-core/register';

tsconfig({
    indent: 2
});

let tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', () => {
    return del([
        'build',
        'dist',
        'docs'
    ])
});


gulp.task('build', ['clean'], () => {
    return tsProject.src()
        .pipe(ts(tsProject))
        .js
        .pipe(gulp.dest('build'));
});


gulp.task('test', ['build'], () => {
    return gulp.src('build/test/*.js', {read: false})
        .pipe(mocha({reporter: 'list'}))
        .on('error', gutil.log);

});


gulp.task('dist', ['build'], () => {
    return gulp.src('build/src/**/*.js', {base: 'build/src'})
        .pipe(gulp.dest('dist/es6'))
        .pipe(babel())
        .pipe(gulp.dest('dist/es5'));
});


gulp.task("typedoc", () => {
    return tsProject.src()
        .pipe(typedoc(Object.assign({}, tsProject.config.compilerOptions, {
            out: "./docs",

            name: "Keyper",
            version: true
        })));
});


gulp.task('default', ['build', 'test', 'dist', 'typedoc']);