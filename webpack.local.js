const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const PORT = process.env.PORT || 8080;
const {
  BACKEND_PROTOCOL = 'https',
} = process.env;

module.exports = {
  mode: 'development',
  devServer: {
    historyApiFallback: true,
    host: '::',
    port: PORT,
  },
  devtool: 'sourcemap',
  entry: [
    `webpack-dev-server/client?http://[::]:${PORT}`, // WebpackDevServer host and port
    'webpack/hot/only-dev-server', // "only" prevents reload on syntax errors
    path.resolve(__dirname, 'src/index.js'),
  ],
  output: {
    publicPath: '/',
    filename: 'bundle.js',
    chunkFilename: '[chunkhash].js',
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [{
      test: /\.js$/,
      use: [
        { loader: 'babel-loader?cacheDirectory=true' },
      ],
      exclude: /node_modules/,
    }, {
      test: /\.(gif|png|jpe?g|svg)$/,
      loader: 'url-loader?limit=8192&name=static/images/[hash].[ext]',
    }, {
      test: /\.css$/,
      use: [
        { loader: 'style-loader' },
        { loader: 'css-loader?importLoaders=1' },
        { loader: 'postcss-loader' },
      ],
    }, {
      test: /\.less$/,
      use: [
        { loader: 'style-loader' },
        { loader: 'css-loader?importLoaders=1' },
        { loader: 'postcss-loader' },
        {
          loader: 'less-loader',
          options: {
            javascriptEnabled: true,
            paths: [
              path.resolve(__dirname, 'node_modules'),
              path.resolve(__dirname, 'src'),
            ],
          },
        },
      ],
    }],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        BACKEND_PROTOCOL: JSON.stringify(BACKEND_PROTOCOL),
      },
    }),
    new webpack.HotModuleReplacementPlugin(),
    new webpack.NoEmitOnErrorsPlugin(),
    new HtmlWebpackPlugin({
      title: 'HankLiuRTC-demo',
      template: path.resolve(__dirname, 'src/template.html'),
      filename: 'index.html',
    }),
  ],
};
